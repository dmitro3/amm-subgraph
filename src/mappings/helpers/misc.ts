import { Address, BigDecimal, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  Pool,
  PoolShare,
  PoolShareLoss,
  PoolSnapshot,
  PoolToken,
  SwapToken,
  VirtualSwap,
} from "../../types/schema";
import { LOG_SWAP } from "../../types/templates/Pool/Pool";
import { ZERO_BD } from "../helpers";
import {
  isPricingAsset,
  isUSDStable,
  updatePoolLiquidityV2,
  updatePoolLiquidityWithoutBlock,
  valueInUSD,
} from "../pricing";

const DAY = 24 * 60 * 60;

export function getTokenPriceId(
  poolId: string,
  tokenAddress: Address,
  stableTokenAddress: Address,
  block: BigInt
): string {
  return poolId
    .concat("-")
    .concat(tokenAddress.toHexString())
    .concat("-")
    .concat(stableTokenAddress.toHexString())
    .concat("-")
    .concat(block.toString());
}

export function getPoolTokenId(poolId: string, tokenAddress: Address): string {
  return poolId.concat("-").concat(tokenAddress.toHexString());
}

export function loadPoolToken(
  poolId: string,
  tokenAddress: Address
): PoolToken | null {
  return PoolToken.load(getPoolTokenId(poolId, tokenAddress));
}

export function createPoolSnapshot(poolId: string, timestamp: i32): void {
  let dayTimestamp = timestamp - (timestamp % DAY); // Todays Timestamp

  let pool = Pool.load(poolId);
  // Save pool snapshot
  let snapshotId = poolId + "-" + dayTimestamp.toString();
  let snapshot = new PoolSnapshot(snapshotId);

  if (!pool.tokensList) {
    return;
  }

  let tokens = pool.tokensList;
  let amounts = new Array<BigDecimal>(tokens.length);
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i];
    let tokenAddress = Address.fromString(token.toHexString());
    let poolToken = loadPoolToken(poolId, tokenAddress);

    amounts[i] = poolToken.balance;
  }

  snapshot.pool = poolId;
  snapshot.amounts = amounts;
  snapshot.totalShares = pool.totalShares;
  snapshot.swapVolume = ZERO_BD;
  snapshot.swapFees = pool.totalSwapFee;
  snapshot.timestamp = dayTimestamp;
  snapshot.save();
}

export function saveSwapToSnapshot(
  poolAddress: string,
  timestamp: i32,
  volume: BigDecimal,
  fees: BigDecimal
): void {
  let dayTimestamp = timestamp - (timestamp % DAY); // Todays timestamp

  // Save pool snapshot
  let snapshotId = poolAddress + "-" + dayTimestamp.toString();
  let snapshot = PoolSnapshot.load(snapshotId);

  if (!snapshot) {
    return;
  }

  snapshot.swapVolume = snapshot.swapVolume.plus(volume);
  snapshot.swapFees = snapshot.swapFees.plus(fees);
  snapshot.save();
}

export function getTimestampLogIndex(
  timestamp: BigInt,
  logIndex: BigInt
): BigInt {
  // assume that transaction has maximum ? log
  return timestamp.times(BigInt.fromI32(10000)).plus(logIndex);
}

/// share swap fee to each pool share
export function updateShareSwapFee(poolId: string, swapFee: BigDecimal): void {
  if (swapFee.equals(ZERO_BD)) {
    return;
  }
  let pool = Pool.load(poolId);
  if (pool == null) {
    return;
  }
  if (pool.totalShares.equals(ZERO_BD)) {
    return;
  }

  let users = pool.liquidityProvidersList;
  for (let i = 0; i < users.length; i++) {
    let shareId = poolId.concat("-").concat(users[i].toHexString());
    let poolShare = PoolShare.load(shareId);
    if (poolShare == null) {
      continue;
    }
    if (poolShare.balance.equals(ZERO_BD)) {
      continue;
    }
    let shareSwapFee = swapFee.times(poolShare.balance).div(pool.totalShares);
    poolShare.swapFee = poolShare.swapFee.plus(shareSwapFee);
    poolShare.save();
  }
}

// share loss to each pool share
export function updateShareLoss(
  poolId: string,
  block: BigInt,
  tokenInAddress: Address,
  tokenAmountIn: BigDecimal,
  tokenOutAddress: Address,
  tokenAmountOut: BigDecimal
): void {
  let pool = Pool.load(poolId);
  if (pool == null) {
    return;
  }
  if (pool.totalShares.equals(ZERO_BD)) {
    return;
  }

  let users = pool.liquidityProvidersList;
  for (let i = 0; i < users.length; i++) {
    let poolShareId = poolId.concat("-").concat(users[i].toHexString());
    let poolShare = PoolShare.load(poolShareId);
    if (poolShare == null) {
      continue;
    }
    if (poolShare.balance.equals(ZERO_BD)) {
      continue;
    }

    let lossInId = poolShareId.concat("-").concat(tokenInAddress.toHexString());
    let poolShareLossIn = PoolShareLoss.load(lossInId);
    if (poolShareLossIn == null) {
      poolShareLossIn = new PoolShareLoss(lossInId);
      poolShareLossIn.poolId = poolId;
      poolShareLossIn.poolShareId = poolShareId;
      poolShareLossIn.userAddress = users[i].toHexString();
      poolShareLossIn.tokenAddress = tokenInAddress;
      poolShareLossIn.balance = ZERO_BD;
    }
    let shareLossIn = tokenAmountIn
      .times(poolShare.balance)
      .div(pool.totalShares);
    poolShareLossIn.balance = poolShareLossIn.balance.plus(shareLossIn);
    poolShareLossIn.save();

    let lossOutId = poolShareId
      .concat("-")
      .concat(tokenOutAddress.toHexString());
    let poolShareLossOut = PoolShareLoss.load(lossOutId);
    if (poolShareLossOut == null) {
      poolShareLossOut = new PoolShareLoss(lossOutId);
      poolShareLossOut.poolId = poolId;
      poolShareLossOut.poolShareId = poolShareId;
      poolShareLossOut.userAddress = users[i].toHexString();
      poolShareLossOut.tokenAddress = tokenOutAddress;
      poolShareLossOut.balance = ZERO_BD;
    }
    let shareLossOut = tokenAmountOut
      .times(poolShare.balance)
      .div(pool.totalShares);
    poolShareLossOut.balance = poolShareLossOut.balance.minus(shareLossOut);
    poolShareLossOut.save();

    if (isPricingAsset(tokenInAddress)) {
      preCalculatePoolShareLoss(poolId, block, poolShareId, tokenInAddress);
    } else if (isPricingAsset(tokenOutAddress)) {
      preCalculatePoolShareLoss(poolId, block, poolShareId, tokenOutAddress);
    }
  }
}

// calculate loss sum in USD
export function preCalculatePoolShareLoss(
  poolId: string,
  block: BigInt,
  poolShareId: string,
  pricingAsset: Address
): void {
  let pool = Pool.load(poolId);
  let poolShare = PoolShare.load(poolShareId);
  if (pool == null || poolShare == null) {
    return;
  }

  let newLossUSDValue: BigDecimal = ZERO_BD;
  let tokensList: Bytes[] = pool.tokensList;
  for (let j: i32 = 0; j < tokensList.length; j++) {
    let tokenAddress: Address = Address.fromString(tokensList[j].toHexString());
    let poolShareLossId = poolShareId
      .concat("-")
      .concat(tokenAddress.toHexString());
    let poolShareLoss = PoolShareLoss.load(poolShareLossId);
    if (poolShareLoss == null) {
      continue;
    }

    let poolLossQuantity: BigDecimal = poolShareLoss.balance;
    let poolTokenValue = valueInUSD(poolLossQuantity, tokenAddress) || ZERO_BD;
    newLossUSDValue = newLossUSDValue.plus(poolTokenValue);
  }

  poolShare.loss = newLossUSDValue;
  poolShare.save();
}

export function transferLoss(
  poolId: string,
  block: BigInt,
  poolShareFromId: string,
  ratio: BigDecimal,
  poolShareToId: string | null
): void {
  let pool = Pool.load(poolId);
  let poolShareFrom = PoolShare.load(poolShareFromId);
  if (pool == null || poolShareFrom == null) {
    return;
  }

  let tokensList: Bytes[] = pool.tokensList;
  for (let j: i32 = 0; j < tokensList.length; j++) {
    let tokenAddress: Address = Address.fromString(tokensList[j].toHexString());
    let poolShareLossFromId = poolShareFromId
      .concat("-")
      .concat(tokenAddress.toHexString());
    let poolShareLossFrom = PoolShareLoss.load(poolShareLossFromId);
    if (poolShareLossFrom == null) {
      continue;
    }

    let burnedLoss = poolShareLossFrom.balance.times(ratio);
    poolShareLossFrom.balance = poolShareLossFrom.balance.minus(burnedLoss);
    poolShareLossFrom.save();

    if (poolShareToId != null) {
      let poolShareTo = PoolShare.load(poolShareToId);
      if (poolShareTo == null) {
        continue;
      }
      let poolShareLossToId = poolShareToId
        .concat("-")
        .concat(tokenAddress.toHexString());
      let poolShareLossTo = PoolShareLoss.load(poolShareLossToId);
      if (poolShareLossTo == null) {
        poolShareLossTo = new PoolShareLoss(poolShareLossToId);
        poolShareLossTo.poolId = poolId;
        poolShareLossTo.poolShareId = poolShareToId;
        poolShareLossTo.userAddress = poolShareTo.userAddress;
        poolShareLossTo.tokenAddress = tokenAddress;
        poolShareLossTo.balance = ZERO_BD;
      }

      poolShareLossTo.balance = poolShareLossTo.balance.plus(burnedLoss);
      poolShareLossTo.save();
    }
  }

  for (let j: i32 = 0; j < tokensList.length; j++) {
    let tokenAddress: Address = Address.fromString(tokensList[j].toHexString());
    if (isPricingAsset(tokenAddress)) {
      preCalculatePoolShareLoss(poolId, block, poolShareFromId, tokenAddress);

      if (poolShareToId != null) {
        preCalculatePoolShareLoss(poolId, block, poolShareToId, tokenAddress);
      }
      break;
    }
  }
}

/// share swap fee to each pool share
export function updateAllPoolsLiquidity(asset: Address, event: LOG_SWAP): void {
  if (isUSDStable(asset)) {
    return;
  }

  let swapToken = SwapToken.load(asset.toHexString());
  if (swapToken == null) {
    return;
  }
  let poolLists = swapToken.poolsList;
  for (let i: i32 = 0; i < poolLists.length; i++) {
    let poolId = poolLists[i].toHexString();
    updatePoolLiquidityWithoutBlock(poolId);

    createVirtualSwap(
      poolId,
      event.transaction.hash.toHexString(),
      event.logIndex,
      event.block.timestamp
    );
  }
}

export function createVirtualSwap(
  poolId: string,
  transactionHash: string,
  logIndex: BigInt,
  blockTimestamp: BigInt
): void {
  let pool = Pool.load(poolId);
  if (pool == null) {
    return;
  }
  let swapId = transactionHash
    .concat("-")
    .concat(logIndex.toString())
    .concat("-")
    .concat(poolId);
  let virtualSwap = VirtualSwap.load(swapId);
  if (virtualSwap == null) {
    virtualSwap = new VirtualSwap(swapId);
    virtualSwap.poolAddress = poolId;
  }
  virtualSwap.poolLiquidity = pool.liquidity;
  virtualSwap.timestamp = blockTimestamp.toI32();
  virtualSwap.timestampLogIndex = getTimestampLogIndex(
    blockTimestamp,
    logIndex
  );
  virtualSwap.save();
}
