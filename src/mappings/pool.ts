import { BigInt, Address, Bytes, store, log } from "@graphprotocol/graph-ts";
import {
  LOG_CALL,
  LOG_JOIN,
  LOG_EXIT,
  LOG_SWAP,
  Transfer,
  GulpCall,
} from "../types/templates/Pool/Pool";
import {
  LogJoin,
  LogExit,
  Transfer as CrpTransfer,
} from "../types/templates/CrpController/ConfigurableRightsPool";
import { Pool as BPool } from "../types/templates/Pool/Pool";
import {
  Balancer,
  Pool,
  PoolToken,
  PoolShare,
  Swap,
  TokenPrice,
  Add,
  AddToken,
  Withdraw,
  WithdrawToken,
  SwapPair,
  SwapToken,
  TokenPriceV2,
} from "../types/schema";
import {
  hexToDecimal,
  bigIntToDecimal,
  tokenToDecimal,
  createPoolShareEntity,
  createPoolTokenEntity,
  getCrpUnderlyingPool,
  saveTransaction,
  ZERO_BD,
  decrPoolCount,
  getPoolRoles,
  ADMIN_ROLE,
  RESTRICTED_ROLE,
  UNRESTRICTED_ROLE,
  getTokensLiquidity,
} from "./helpers";
import {
  ConfigurableRightsPool,
  OwnershipTransferred,
} from "../types/Factory/ConfigurableRightsPool";
import { BPoolExtension } from "../types/Factory/BPoolExtension";
import { isPricingAsset, updatePoolLiquidityV2, valueInUSD } from "./pricing";
import {
  createPoolSnapshot,
  createVirtualSwap,
  getTimestampLogIndex,
  getTokenPriceId,
  loadPoolToken,
  saveSwapToSnapshot,
  transferLoss,
  updateAllPoolsLiquidity,
  updateShareLoss,
  updateShareSwapFee,
} from "./helpers/misc";
import { ONE_BD } from "./helpers/constants";

/************************************
 ********** Pool Controls ***********
 ************************************/

export function handleSetSwapFee(event: LOG_CALL): void {
  let poolId = event.address.toHex();
  let pool = Pool.load(poolId);
  let swapFee = hexToDecimal(event.params.data.toHexString().slice(-40), 18);
  pool.swapFee = swapFee;

  pool.netFee = swapFee.minus(pool.protocolFee);
  pool.save();

  saveTransaction(event, "setSwapFee");
}

export function handleSetProtocolFee(event: LOG_CALL): void {
  let poolId = event.address.toHex();
  let pool = Pool.load(poolId);
  let protocolFee = hexToDecimal(
    event.params.data.toHexString().slice(-40),
    18
  );
  pool.protocolFee = protocolFee;
  pool.netFee = pool.swapFee.minus(protocolFee);
  pool.save();

  saveTransaction(event, "setProtocolFee");
}

export function handleSetRoles(event: LOG_CALL): void {
  let poolId = event.address.toHex();
  let pool = Pool.load(poolId);
  let roles = getPoolRoles(event.address);
  pool.admin = roles[0];
  pool.restricted = roles[1];
  pool.unrestricted = roles[2];
  pool.save();
  saveTransaction(event, "setRoles");
}

export function handleSetController(event: LOG_CALL): void {
  let poolId = event.address.toHex();
  let pool = Pool.load(poolId);
  let controller = Address.fromString(
    event.params.data.toHexString().slice(-40)
  );
  pool.controller = controller;
  pool.save();

  saveTransaction(event, "setController");
}

export function handleSetCrpController(event: OwnershipTransferred): void {
  // This event occurs on the CRP contract rather than the underlying pool so we must perform a lookup.
  let crp = ConfigurableRightsPool.bind(event.address);
  let pool = Pool.load(getCrpUnderlyingPool(crp));
  pool.crpController = event.params.newOwner;
  pool.save();

  // We overwrite event address so that ownership transfers can be linked to Pool entities for above reason.
  event.address = Address.fromString(pool.id);
  saveTransaction(event, "setCrpController");
}

export function handleSetPublicSwap(event: LOG_CALL): void {
  let poolId = event.address.toHex();
  let pool = Pool.load(poolId);
  let publicSwap = event.params.data.toHexString().slice(-1) == "1";
  pool.publicSwap = publicSwap;
  pool.save();

  // TODO: FCX additional logic
  if (pool.liquidity.equals(ZERO_BD)) {
    let tokenAddresses = pool.tokensList;
    for (let i: i32 = 0; i < tokenAddresses.length; i++) {
      let tokenAddress: Address = Address.fromString(
        tokenAddresses[i].toHexString()
      );
      if (isPricingAsset(tokenAddress)) {
        updatePoolLiquidityV2(poolId, event.block.number, tokenAddress);
        createVirtualSwap(
          poolId,
          event.transaction.hash.toHexString(),
          event.logIndex,
          event.block.timestamp
        );
        break;
      }
    }
  }

  saveTransaction(event, "setPublicSwap");
}

export function handleFinalize(event: LOG_CALL): void {
  let poolId = event.address.toHex();
  let pool = Pool.load(poolId);
  // let balance = BigDecimal.fromString('100')
  pool.finalized = true;
  pool.symbol = "FPT";
  pool.publicSwap = true;
  // pool.totalShares = balance
  pool.save();

  /*
  let poolShareId = poolId.concat('-').concat(event.params.caller.toHex())
  let poolShare = PoolShare.load(poolShareId)
  if (poolShare == null) {
    createPoolShareEntity(poolShareId, poolId, event.params.caller.toHex())
    poolShare = PoolShare.load(poolShareId)
  }
  poolShare.balance = balance
  poolShare.save()
  */

  let factory = Balancer.load("1");
  factory.finalizedPoolCount = factory.finalizedPoolCount + 1;
  factory.save();

  // TODO: FCX additional logic
  if (pool.liquidity.equals(ZERO_BD)) {
    let tokenAddresses = pool.tokensList;
    for (let i: i32 = 0; i < tokenAddresses.length; i++) {
      let tokenAddress: Address = Address.fromString(
        tokenAddresses[i].toHexString()
      );
      if (isPricingAsset(tokenAddress)) {
        updatePoolLiquidityV2(poolId, event.block.number, tokenAddress);
        createVirtualSwap(
          poolId,
          event.transaction.hash.toHexString(),
          event.logIndex,
          event.block.timestamp
        );
        break;
      }
    }
  }

  saveTransaction(event, "finalize");
}

export function handleRebind(event: LOG_CALL): void {
  let poolId = event.address.toHex();
  let pool = Pool.load(poolId);
  let tokenBytes = Bytes.fromHexString(
    event.params.data.toHexString().slice(34, 74)
  ) as Bytes;
  let tokensList = pool.tokensList || [];
  if (tokensList.indexOf(tokenBytes) == -1) {
    tokensList.push(tokenBytes);
  }
  pool.tokensList = tokensList;
  pool.tokensCount = BigInt.fromI32(tokensList.length);

  let address = Address.fromString(
    event.params.data.toHexString().slice(34, 74)
  );
  let denormWeight = hexToDecimal(
    event.params.data.toHexString().slice(138),
    18
  );

  let poolTokenId = poolId.concat("-").concat(address.toHexString());
  let poolToken = PoolToken.load(poolTokenId);
  if (poolToken == null) {
    createPoolTokenEntity(poolTokenId, poolId, address.toHexString());
    poolToken = PoolToken.load(poolTokenId);
    pool.totalWeight += denormWeight;
  } else {
    let oldWeight = poolToken.denormWeight;
    if (denormWeight > oldWeight) {
      pool.totalWeight = pool.totalWeight + (denormWeight - oldWeight);
    } else {
      pool.totalWeight = pool.totalWeight - (oldWeight - denormWeight);
    }
  }

  // 1 token has multiple pools
  let swapToken = SwapToken.load(address.toHexString());
  if (swapToken == null) {
    swapToken = new SwapToken(address.toHexString());
    swapToken.poolsList = [];
    swapToken.liquidity = ZERO_BD;
  }
  let poolsList = swapToken.poolsList || [];
  let poolBytes = Bytes.fromHexString(poolId) as Bytes;
  if (poolsList.indexOf(poolBytes) == -1) {
    poolsList.push(poolBytes);
  }
  swapToken.poolsList = poolsList;
  swapToken.save();

  let balance = hexToDecimal(
    event.params.data.toHexString().slice(74, 138),
    poolToken.decimals
  );

  poolToken.balance = balance;
  poolToken.denormWeight = denormWeight;
  poolToken.save();

  if (balance.equals(ZERO_BD)) {
    decrPoolCount(pool.active, pool.finalized, pool.crp);
    pool.active = false;
  }
  pool.save();

  let tokenAddresses = pool.tokensList;
  for (let i: i32 = 0; i < tokenAddresses.length; i++) {
    let tokenAddress: Address = Address.fromString(
      tokenAddresses[i].toHexString()
    );
    if (isPricingAsset(tokenAddress)) {
      updatePoolLiquidityV2(poolId, event.block.number, tokenAddress);
      createVirtualSwap(
        poolId,
        event.transaction.hash.toHexString(),
        event.logIndex,
        event.block.timestamp
      );
      break;
    }
  }
  saveTransaction(event, "rebind");
}

export function handleUnbind(event: LOG_CALL): void {
  let poolId = event.address.toHex();
  let pool = Pool.load(poolId);
  let tokenBytes = Bytes.fromHexString(
    event.params.data.toHexString().slice(-40)
  ) as Bytes;
  let tokensList = pool.tokensList || [];
  let index = tokensList.indexOf(tokenBytes);
  tokensList.splice(index, 1);
  pool.tokensList = tokensList;
  pool.tokensCount = BigInt.fromI32(tokensList.length);

  let address = Address.fromString(event.params.data.toHexString().slice(-40));
  let poolTokenId = poolId.concat("-").concat(address.toHexString());
  let poolToken = PoolToken.load(poolTokenId);
  pool.totalWeight -= poolToken.denormWeight;
  pool.save();
  store.remove("PoolToken", poolTokenId);

  let swapToken = SwapToken.load(address.toHexString());
  if (swapToken !== null) {
    let poolsList = swapToken.poolsList || [];
    let poolBytes = Bytes.fromHexString(poolId) as Bytes;
    let index = poolsList.indexOf(poolBytes);
    poolsList.splice(index, 1);
    swapToken.poolsList = poolsList;
  }

  let tokenAddresses = pool.tokensList;
  for (let i: i32 = 0; i < tokenAddresses.length; i++) {
    let tokenAddress: Address = Address.fromString(
      tokenAddresses[i].toHexString()
    );
    if (isPricingAsset(tokenAddress)) {
      updatePoolLiquidityV2(poolId, event.block.number, tokenAddress);
      createVirtualSwap(
        poolId,
        event.transaction.hash.toHexString(),
        event.logIndex,
        event.block.timestamp
      );
      break;
    }
  }
  saveTransaction(event, "unbind");
}

export function handleGulp(event: LOG_CALL): void {
  let poolId = event.address.toHex();
  let pool = Pool.load(poolId);
  let address = Address.fromString(
    event.params.data.toHexString().slice(-40)
  ) as Address;

  let bpool = BPool.bind(Address.fromString(poolId));
  let balanceCall = bpool.try_getBalance(address);

  let poolTokenId = poolId.concat("-").concat(address.toHexString());
  let poolToken = PoolToken.load(poolTokenId);

  if (poolToken != null) {
    let balance = ZERO_BD;
    if (!balanceCall.reverted) {
      balance = bigIntToDecimal(balanceCall.value, poolToken.decimals);
    }
    poolToken.balance = balance;
    poolToken.save();
  }

  let tokenAddresses = pool.tokensList;
  for (let i: i32 = 0; i < tokenAddresses.length; i++) {
    let tokenAddress: Address = Address.fromString(
      tokenAddresses[i].toHexString()
    );
    if (isPricingAsset(tokenAddress)) {
      updatePoolLiquidityV2(poolId, event.block.number, tokenAddress);
      createVirtualSwap(
        poolId,
        event.transaction.hash.toHexString(),
        event.logIndex,
        event.block.timestamp
      );
      break;
    }
  }
  saveTransaction(event, "gulp");
}

/************************************
 ********** JOINS & EXITS ***********
 ************************************/

export function handleJoinPool(event: LOG_JOIN): void {
  let poolId = event.address.toHex();
  let pool = Pool.load(poolId);
  let address = event.params.tokenIn.toHex();
  let poolTokenId = poolId.concat("-").concat(address.toString());
  let poolToken = PoolToken.load(poolTokenId);
  let tokenAmountIn = tokenToDecimal(
    event.params.tokenAmountIn.toBigDecimal(),
    poolToken.decimals
  );
  let newAmount = poolToken.balance.plus(tokenAmountIn);
  poolToken.balance = newAmount;
  poolToken.save();

  let addId = event.transaction.hash.toHexString();
  let add = Add.load(addId);
  if (add == null) {
    add = new Add(addId);
    add.poolAddress = event.address.toHex();
    add.timestamp = event.block.timestamp.toI32();
    add.caller = event.params.caller;
    add.userAddress = event.transaction.from.toHex();
    pool.joinsCount += BigInt.fromI32(1);
    add.tokensList = [];
    // add.save()
  }
  pool.save();

  let tokenIn = event.params.tokenIn.toHex();
  let poolTokenInId = poolId.concat("-").concat(tokenIn.toString());
  let poolTokenIn = PoolToken.load(poolTokenInId);

  let addToken = AddToken.load(
    addId.concat("-").concat(event.logIndex.toString())
  );
  if (addToken == null) {
    addToken = new AddToken(
      addId.concat("-").concat(event.logIndex.toString())
    );
  }
  addToken.addAddress = addId;
  addToken.tokenIn = event.params.tokenIn;
  addToken.tokenInSym = poolTokenIn.symbol;
  addToken.tokenAmountIn = tokenAmountIn;
  addToken.save();

  //updateTokensList
  let tokensList = add.tokensList || [];
  if (tokensList.indexOf(event.params.tokenIn) == -1) {
    tokensList.push(event.params.tokenIn);
  }
  add.tokensList = tokensList;

  let tokenAddresses = pool.tokensList;
  for (let i: i32 = 0; i < tokenAddresses.length; i++) {
    let tokenAddress: Address = Address.fromString(
      tokenAddresses[i].toHexString()
    );
    if (isPricingAsset(tokenAddress)) {
      updatePoolLiquidityV2(poolId, event.block.number, tokenAddress);
      break;
    }
  }

  pool = Pool.load(poolId);
  let tokenInUSDValue =
    valueInUSD(tokenAmountIn, event.params.tokenIn) || ZERO_BD;
  let newTotalAddVolume = pool.totalAddVolume.plus(tokenInUSDValue);
  pool.totalAddVolume = newTotalAddVolume;
  pool.save();
  add.poolTotalAddVolume = newTotalAddVolume;
  add.poolLiquidity = pool.liquidity;
  add.save();

  saveTransaction(event, "join");
}

export function handleJoinCrpPool(event: LogJoin): void {
  let crp = ConfigurableRightsPool.bind(event.address);
  let pool = Pool.load(getCrpUnderlyingPool(crp));
  // let poolId = event.address.toHex();
  // let pool = Pool.load(poolId);
  let poolId = pool.id;

  let address = event.params.tokenIn.toHex();
  let poolTokenId = poolId.concat("-").concat(address.toString());
  let poolToken = PoolToken.load(poolTokenId);
  let tokenAmountIn = tokenToDecimal(
    event.params.tokenAmountIn.toBigDecimal(),
    poolToken.decimals
  );
  let newAmount = poolToken.balance.plus(tokenAmountIn);
  poolToken.balance = newAmount;
  poolToken.save();

  let addId = event.transaction.hash.toHexString();
  let add = Add.load(addId);
  if (add == null) {
    add = new Add(addId);
    add.poolAddress = poolId;
    add.timestamp = event.block.timestamp.toI32();
    add.caller = event.params.caller;
    add.userAddress = event.transaction.from.toHex();
    add.tokensList = [];
    pool.joinsCount += BigInt.fromI32(1);
    // add.save();
  }
  pool.save();

  let tokenIn = event.params.tokenIn.toHex();
  let poolTokenInId = poolId.concat("-").concat(tokenIn.toString());
  let poolTokenIn = PoolToken.load(poolTokenInId);

  let addToken = AddToken.load(
    addId.concat("-").concat(event.logIndex.toString())
  );
  // if (addToken == null) {
  //   addToken = new AddToken(
  //     addId.concat("-").concat(event.logIndex.toString())
  //   );
  // }
  addToken = new AddToken(addId.concat("-").concat(event.logIndex.toString()));
  addToken.addAddress = addId;
  addToken.tokenIn = event.params.tokenIn;
  addToken.tokenInSym = poolTokenIn.symbol;
  addToken.tokenAmountIn = tokenAmountIn;
  addToken.save();

  //updateTokensList
  let tokensList = add.tokensList || [];
  if (tokensList.indexOf(event.params.tokenIn) == -1) {
    tokensList.push(event.params.tokenIn);
  }
  add.tokensList = tokensList;

  let tokenAddresses = pool.tokensList;
  for (let i: i32 = 0; i < tokenAddresses.length; i++) {
    let tokenAddress: Address = Address.fromString(
      tokenAddresses[i].toHexString()
    );
    if (isPricingAsset(tokenAddress)) {
      updatePoolLiquidityV2(poolId, event.block.number, tokenAddress);
      break;
    }
  }

  pool = Pool.load(poolId);
  let tokenInUSDValue =
    valueInUSD(tokenAmountIn, event.params.tokenIn) || ZERO_BD;
  let newTotalAddVolume = pool.totalAddVolume.plus(tokenInUSDValue);
  pool.totalAddVolume = newTotalAddVolume;
  pool.save();
  add.poolTotalAddVolume = newTotalAddVolume;
  add.poolLiquidity = pool.liquidity;
  add.save();

  saveTransaction(event, "join");
}

export function handleExitPool(event: LOG_EXIT): void {
  let poolId = event.address.toHex();
  let pool = Pool.load(poolId);
  let address = event.params.tokenOut.toHex();
  let poolTokenId = poolId.concat("-").concat(address.toString());
  let poolToken = PoolToken.load(poolTokenId);
  let tokenAmountOut = tokenToDecimal(
    event.params.tokenAmountOut.toBigDecimal(),
    poolToken.decimals
  );
  let newAmount = poolToken.balance.minus(tokenAmountOut);
  poolToken.balance = newAmount;
  poolToken.save();

  let withdrawId = event.transaction.hash.toHexString();
  let withdraw = Withdraw.load(withdrawId);
  if (withdraw == null) {
    withdraw = new Withdraw(withdrawId);
    withdraw.poolAddress = event.address.toHex();
    withdraw.timestamp = event.block.timestamp.toI32();
    withdraw.caller = event.params.caller;
    withdraw.userAddress = event.transaction.from.toHex();
    withdraw.tokensList = [];
    // withdraw.save();
    pool.exitsCount += BigInt.fromI32(1);
  }

  let tokenOut = event.params.tokenOut.toHex();
  let poolTokenOutId = poolId.concat("-").concat(tokenOut.toString());
  let poolTokenOut = PoolToken.load(poolTokenOutId);

  let withdrawToken = WithdrawToken.load(
    withdrawId.concat("-").concat(event.logIndex.toString())
  );
  if (withdrawToken == null) {
    withdrawToken = new WithdrawToken(
      withdrawId.concat("-").concat(event.logIndex.toString())
    );
  }

  withdrawToken.withdrawAddress = withdrawId;
  withdrawToken.tokenOut = event.params.tokenOut;
  withdrawToken.tokenOutSym = poolTokenOut.symbol;
  withdrawToken.tokenAmountOut = tokenAmountOut;
  withdrawToken.save();

  if (newAmount.equals(ZERO_BD)) {
    decrPoolCount(pool.active, pool.finalized, pool.crp);
    pool.active = false;
  }
  pool.save();

  //updateTokensList
  let tokensList = withdraw.tokensList || [];
  if (tokensList.indexOf(event.params.tokenOut) == -1) {
    tokensList.push(event.params.tokenOut);
  }
  withdraw.tokensList = tokensList;

  let tokenAddresses = pool.tokensList;
  for (let i: i32 = 0; i < tokenAddresses.length; i++) {
    let tokenAddress: Address = Address.fromString(
      tokenAddresses[i].toHexString()
    );
    if (isPricingAsset(tokenAddress)) {
      updatePoolLiquidityV2(poolId, event.block.number, tokenAddress);
      break;
    }
  }

  pool = Pool.load(poolId);
  let tokenOutUSDValue =
    valueInUSD(tokenAmountOut, event.params.tokenOut) || ZERO_BD;
  let newTotalWithdrawVolume = pool.totalWithdrawVolume.plus(tokenOutUSDValue);
  pool.totalWithdrawVolume = newTotalWithdrawVolume;
  pool.save();
  withdraw.poolTotalWithdrawVolume = newTotalWithdrawVolume;
  withdraw.poolLiquidity = pool.liquidity;
  withdraw.save();

  saveTransaction(event, "exit");
}

export function handleExitCrpPool(event: LogExit): void {
  let crp = ConfigurableRightsPool.bind(event.address);
  let pool = Pool.load(getCrpUnderlyingPool(crp));
  // let poolId = event.address.toHex();
  // let pool = Pool.load(poolId);
  let poolId = pool.id;

  let address = event.params.tokenOut.toHex();
  let poolTokenId = poolId.concat("-").concat(address.toString());
  let poolToken = PoolToken.load(poolTokenId);
  let tokenAmountOut = tokenToDecimal(
    event.params.tokenAmountOut.toBigDecimal(),
    poolToken.decimals
  );
  let newAmount = poolToken.balance.minus(tokenAmountOut);
  poolToken.balance = newAmount;
  poolToken.save();

  let withdrawId = event.transaction.hash.toHexString();
  let withdraw = Withdraw.load(withdrawId);
  if (withdraw == null) {
    withdraw = new Withdraw(withdrawId);
    withdraw.poolAddress = poolId;
    withdraw.timestamp = event.block.timestamp.toI32();
    withdraw.caller = event.params.caller;
    withdraw.userAddress = event.transaction.from.toHex();
    withdraw.tokensList = [];
    // withdraw.save();
    pool.exitsCount += BigInt.fromI32(1);
  }

  let tokenOut = event.params.tokenOut.toHex();
  let poolTokenOutId = poolId.concat("-").concat(tokenOut.toString());
  let poolTokenOut = PoolToken.load(poolTokenOutId);

  let withdrawToken = WithdrawToken.load(
    withdrawId.concat("-").concat(event.logIndex.toString())
  );
  if (withdrawToken == null) {
    withdrawToken = new WithdrawToken(
      withdrawId.concat("-").concat(event.logIndex.toString())
    );
  }
  withdrawToken.withdrawAddress = withdrawId;
  withdrawToken.tokenOut = event.params.tokenOut;
  withdrawToken.tokenOutSym = poolTokenOut.symbol;
  withdrawToken.tokenAmountOut = tokenAmountOut;
  withdrawToken.save();

  // let pool = Pool.load(poolId);
  if (newAmount.equals(ZERO_BD)) {
    decrPoolCount(pool.active, pool.finalized, pool.crp);
    pool.active = false;
  }
  pool.save();

  //updateTokensList
  let tokensList = withdraw.tokensList || [];
  if (tokensList.indexOf(event.params.tokenOut) == -1) {
    tokensList.push(event.params.tokenOut);
  }
  withdraw.tokensList = tokensList;

  let tokenAddresses = pool.tokensList;
  for (let i: i32 = 0; i < tokenAddresses.length; i++) {
    let tokenAddress: Address = Address.fromString(
      tokenAddresses[i].toHexString()
    );
    if (isPricingAsset(tokenAddress)) {
      updatePoolLiquidityV2(poolId, event.block.number, tokenAddress);
      break;
    }
  }

  pool = Pool.load(poolId);
  let tokenOutUSDValue =
    valueInUSD(tokenAmountOut, event.params.tokenOut) || ZERO_BD;
  let newTotalWithdrawVolume = pool.totalWithdrawVolume.plus(tokenOutUSDValue);
  pool.totalWithdrawVolume = newTotalWithdrawVolume;
  pool.save();
  withdraw.poolTotalWithdrawVolume = newTotalWithdrawVolume;
  withdraw.poolLiquidity = pool.liquidity;
  withdraw.save();

  saveTransaction(event, "exit");
}

/************************************
 ************** SWAPS ***************
 ************************************/

export function handleSwap(event: LOG_SWAP): void {
  let poolId = event.address.toHex();
  let pool = Pool.load(poolId);
  if (pool == null) {
    log.warning("Pool not found in handleSwapEvent: {}", [poolId]);
    return;
  }

  // tokenIn
  let tokenIn = event.params.tokenIn.toHex();
  let tokenInAddress: Address = event.params.tokenIn;
  let poolTokenIn = loadPoolToken(poolId, tokenInAddress);
  let tokenAmountIn = tokenToDecimal(
    event.params.tokenAmountIn.toBigDecimal(),
    poolTokenIn.decimals
  );
  let protocolAmountIn = tokenAmountIn.times(pool.protocolFee);
  let newAmountIn = poolTokenIn.balance
    .plus(tokenAmountIn)
    .minus(protocolAmountIn);
  poolTokenIn.balance = newAmountIn;
  poolTokenIn.save();

  // tokenOut
  let tokenOut = event.params.tokenOut.toHex();
  let tokenOutAddress: Address = event.params.tokenOut;
  let poolTokenOut = loadPoolToken(poolId, tokenOutAddress);
  let tokenAmountOut = tokenToDecimal(
    event.params.tokenAmountOut.toBigDecimal(),
    poolTokenOut.decimals
  );
  let newAmountOut = poolTokenOut.balance.minus(tokenAmountOut);
  poolTokenOut.balance = newAmountOut;
  poolTokenOut.save();

  let swapId = event.transaction.hash
    .toHexString()
    .concat("-")
    .concat(event.logIndex.toString());
  let swap = Swap.load(swapId);
  if (swap == null) {
    swap = new Swap(swapId);
  }

  // update volume
  let totalSwapVolume = pool.totalSwapVolume;
  let totalSwapFee = pool.totalSwapFee;
  let totalProtocolFee = pool.totalProtocolFee;
  let totalNetFee = pool.totalNetFee;
  let liquidity = pool.liquidity;
  let factory = Balancer.load("1");

  let swapValueUSD =
    valueInUSD(tokenAmountOut, tokenOutAddress) ||
    valueInUSD(tokenAmountIn, tokenInAddress) ||
    ZERO_BD;
  let swapFee = pool.swapFee;
  let swapFeesUSD = swapValueUSD.times(swapFee);
  let protocolFeesUSD = swapValueUSD.times(pool.protocolFee);
  let netFeesUSD = swapFeesUSD.minus(protocolFeesUSD);
  totalSwapVolume = totalSwapVolume.plus(swapValueUSD);
  totalSwapFee = totalSwapFee.plus(swapFeesUSD);
  totalProtocolFee = totalProtocolFee.plus(protocolFeesUSD);
  totalNetFee = totalNetFee.plus(netFeesUSD);

  factory.totalSwapVolume = factory.totalSwapVolume.plus(swapValueUSD);
  factory.totalSwapFee = factory.totalSwapFee.plus(swapFeesUSD);
  factory.totalProtocolFee = factory.totalProtocolFee.plus(protocolFeesUSD);
  factory.totalNetFee = factory.totalNetFee.plus(netFeesUSD);

  pool.totalSwapVolume = totalSwapVolume;
  pool.totalSwapFee = totalSwapFee;
  pool.totalProtocolFee = totalProtocolFee;
  pool.totalNetFee = totalNetFee;

  pool.swapsCount = pool.swapsCount.plus(BigInt.fromI32(1));
  factory.txCount = factory.txCount.plus(BigInt.fromI32(1));

  // zero in or out
  if (newAmountIn.equals(ZERO_BD) || newAmountOut.equals(ZERO_BD)) {
    decrPoolCount(pool.active, pool.finalized, pool.crp);
    pool.active = false;
  }
  factory.save();
  pool.save();

  // V2
  let block = event.block.number;
  let blockTimestamp = event.block.timestamp.toI32();

  if (isPricingAsset(tokenInAddress)) {
    let tokenPriceId = getTokenPriceId(
      poolId,
      tokenOutAddress,
      tokenInAddress,
      block
    );
    let tokenPrice = new TokenPriceV2(tokenPriceId);
    tokenPrice.poolId = poolId;
    tokenPrice.block = block;
    tokenPrice.timestamp = BigInt.fromI32(blockTimestamp);
    tokenPrice.logIndex = event.logIndex;
    tokenPrice.asset = tokenOutAddress;
    tokenPrice.amount = tokenAmountIn;
    tokenPrice.pricingAsset = tokenInAddress;

    tokenPrice.price = tokenAmountIn.div(tokenAmountOut);
    tokenPrice.save();
    updatePoolLiquidityV2(poolId, block, tokenInAddress);

    // compatible token price
    let tokenOutPriceUSD = valueInUSD(ONE_BD, tokenOutAddress);
    if (tokenOutPriceUSD) {
      let tokenPrice = TokenPrice.load(tokenOut);
      if (tokenPrice == null) {
        tokenPrice = new TokenPrice(tokenOut);
        tokenPrice.poolTokenId = poolTokenOut.id;
        tokenPrice.symbol = poolTokenOut.symbol;
        tokenPrice.name = poolTokenOut.name;
        tokenPrice.decimals = poolTokenOut.decimals;
      }
      tokenPrice.poolLiquidity = pool.liquidity;
      tokenPrice.price = tokenOutPriceUSD;
      tokenPrice.save();
    }

    // recalculate all liquidity
    updateAllPoolsLiquidity(tokenOutAddress, event);
  }
  if (isPricingAsset(tokenOutAddress)) {
    let tokenPriceId = getTokenPriceId(
      poolId,
      tokenInAddress,
      tokenOutAddress,
      block
    );
    let tokenPrice = new TokenPriceV2(tokenPriceId);
    tokenPrice.poolId = poolId;
    tokenPrice.block = block;
    tokenPrice.timestamp = BigInt.fromI32(blockTimestamp);
    tokenPrice.logIndex = event.logIndex;
    tokenPrice.asset = tokenInAddress;
    tokenPrice.amount = tokenAmountOut;
    tokenPrice.pricingAsset = tokenOutAddress;

    tokenPrice.price = tokenAmountOut.div(tokenAmountIn);
    tokenPrice.save();
    updatePoolLiquidityV2(poolId, block, tokenOutAddress);

    // compatible token price
    let tokenInPriceUSD = valueInUSD(ONE_BD, tokenInAddress);
    if (tokenInPriceUSD) {
      let tokenPrice = TokenPrice.load(tokenIn);
      if (tokenPrice == null) {
        tokenPrice = new TokenPrice(tokenIn);
        tokenPrice.poolTokenId = poolTokenIn.id;
        tokenPrice.symbol = poolTokenIn.symbol;
        tokenPrice.name = poolTokenIn.name;
        tokenPrice.decimals = poolTokenIn.decimals;
      }
      tokenPrice.poolLiquidity = pool.liquidity;
      tokenPrice.price = tokenInPriceUSD;
      tokenPrice.save();
    }

    // recalculate all liquidity
    updateAllPoolsLiquidity(tokenInAddress, event);
  }

  createPoolSnapshot(poolId, blockTimestamp);
  saveSwapToSnapshot(poolId, blockTimestamp, swapValueUSD, swapFeesUSD);

  // swapPair
  let tokenA = tokenIn < tokenOut ? tokenIn : tokenOut;
  let tokenB = tokenA == tokenIn ? tokenOut : tokenIn;
  let pairId = tokenA.concat("-").concat(tokenB);
  let swapPair = SwapPair.load(pairId);
  if (swapPair == null) {
    swapPair = new SwapPair(pairId);
    swapPair.swapVolume = ZERO_BD;
  }
  // swapPair liquidity
  let swapPairLiquidity = getTokensLiquidity([tokenA, tokenB]);
  swapPair.liquidity = swapPairLiquidity;
  swapPair.swapVolume = swapPair.swapVolume.plus(swapValueUSD);
  swapPair.save();

  // save swap
  swap.caller = event.params.caller;
  swap.tokenIn = event.params.tokenIn;
  swap.tokenInSym = poolTokenIn.symbol;
  swap.tokenAmountIn = tokenAmountIn;

  swap.tokenOut = event.params.tokenOut;
  swap.tokenOutSym = poolTokenOut.symbol;
  swap.tokenAmountOut = tokenAmountOut;

  swap.poolAddress = event.address.toHex();
  swap.userAddress = event.transaction.from.toHex();

  swap.poolTotalSwapVolume = totalSwapVolume;
  swap.poolTotalSwapFee = totalSwapFee;
  swap.poolTotalProtocolFee = totalProtocolFee;
  swap.poolTotalNetFee = totalNetFee;
  swap.poolLiquidity = liquidity;
  swap.value = swapValueUSD;
  swap.feeValue = swapFeesUSD;
  swap.netFeeValue = netFeesUSD;
  swap.timestamp = event.block.timestamp.toI32();
  swap.timestampLogIndex = getTimestampLogIndex(
    event.block.timestamp,
    event.logIndex
  );
  swap.pairSwapVolume = swapPair.swapVolume;
  swap.pairLiquidity = swapPair.liquidity;
  swap.poolTotalAddVolume = pool.totalAddVolume;
  swap.poolTotalWithdrawVolume = pool.totalWithdrawVolume;
  swap.save();

  saveTransaction(event, "swap");

  // swap fee and impermanent loss
  updateShareSwapFee(poolId, netFeesUSD);
  updateShareLoss(
    poolId,
    block,
    tokenInAddress,
    tokenAmountIn.minus(tokenAmountIn.times(swapFee)),
    tokenOutAddress,
    tokenAmountOut
  );
}

/************************************
 *********** POOL SHARES ************
 ************************************/

export function handleTransfer(event: Transfer): void {
  let poolId = event.address.toHex();

  let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  let isMint = event.params.src.toHex() == ZERO_ADDRESS;
  let isBurn = event.params.dst.toHex() == ZERO_ADDRESS;

  let poolShareFromId = poolId.concat("-").concat(event.params.src.toHex());
  let poolShareFrom = PoolShare.load(poolShareFromId);
  let poolShareFromBalance =
    poolShareFrom == null ? ZERO_BD : poolShareFrom.balance;

  let poolShareToId = poolId.concat("-").concat(event.params.dst.toHex());
  let poolShareTo = PoolShare.load(poolShareToId);
  let poolShareToBalance = poolShareTo == null ? ZERO_BD : poolShareTo.balance;

  let pool = Pool.load(poolId);
  let liquidityProvidersList = pool.liquidityProvidersList || [];
  let transferAmount = tokenToDecimal(event.params.amt.toBigDecimal(), 18);

  if (isMint) {
    if (poolShareTo == null) {
      createPoolShareEntity(poolShareToId, poolId, event.params.dst.toHex());
      poolShareTo = PoolShare.load(poolShareToId);
      liquidityProvidersList.push(event.params.dst);
    }
    poolShareTo.balance = poolShareTo.balance.plus(
      tokenToDecimal(event.params.amt.toBigDecimal(), 18)
    );
    poolShareTo.save();
    pool.totalShares = pool.totalShares.plus(
      tokenToDecimal(event.params.amt.toBigDecimal(), 18)
    );
  } else if (isBurn) {
    if (poolShareFrom == null) {
      createPoolShareEntity(poolShareFromId, poolId, event.params.src.toHex());
      poolShareFrom = PoolShare.load(poolShareFromId);
      liquidityProvidersList.push(event.params.src);
    }

    let burnedSwapFee = poolShareFrom.balance;
    let ratio = ONE_BD;
    if (poolShareFrom.balance.gt(ZERO_BD)) {
      burnedSwapFee = poolShareFrom.swapFee
        .times(transferAmount)
        .div(poolShareFrom.balance);
      ratio = transferAmount.div(poolShareFrom.balance);
    }
    poolShareFrom.swapFee = poolShareFrom.swapFee.minus(burnedSwapFee);
    transferLoss(poolId, event.block.number, poolShareFromId, ratio, null);

    poolShareFrom.balance = poolShareFrom.balance.minus(transferAmount);
    poolShareFrom.save();
    pool.totalShares = pool.totalShares.minus(transferAmount);
  } else {
    if (poolShareFrom == null) {
      createPoolShareEntity(poolShareFromId, poolId, event.params.src.toHex());
      poolShareFrom = PoolShare.load(poolShareFromId);
      liquidityProvidersList.push(event.params.src);
    }
    let burnedSwapFee = poolShareFrom.balance;
    let ratio = ONE_BD;
    if (poolShareFrom.balance.gt(ZERO_BD)) {
      burnedSwapFee = poolShareFrom.swapFee
        .times(transferAmount)
        .div(poolShareFrom.balance);
      ratio = transferAmount.div(poolShareFrom.balance);
    }
    poolShareFrom.swapFee = poolShareFrom.swapFee.minus(burnedSwapFee);

    poolShareFrom.balance = poolShareFrom.balance.minus(
      tokenToDecimal(event.params.amt.toBigDecimal(), 18)
    );
    poolShareFrom.save();

    if (poolShareTo == null) {
      createPoolShareEntity(poolShareToId, poolId, event.params.dst.toHex());
      poolShareTo = PoolShare.load(poolShareToId);
      liquidityProvidersList.push(event.params.dst);
    }
    poolShareTo.swapFee = poolShareTo.swapFee.plus(burnedSwapFee);
    poolShareTo.balance = poolShareTo.balance.plus(
      tokenToDecimal(event.params.amt.toBigDecimal(), 18)
    );
    poolShareTo.save();

    transferLoss(
      poolId,
      event.block.number,
      poolShareFromId,
      ratio,
      poolShareToId
    );
  }

  if (
    poolShareTo !== null &&
    poolShareTo.balance.notEqual(ZERO_BD) &&
    poolShareToBalance.equals(ZERO_BD)
  ) {
    pool.holdersCount = pool.holdersCount.plus(BigInt.fromI32(1));
  }

  if (
    poolShareFrom !== null &&
    poolShareFrom.balance.equals(ZERO_BD) &&
    poolShareFromBalance.notEqual(ZERO_BD)
  ) {
    pool.holdersCount = pool.holdersCount.minus(BigInt.fromI32(1));
  }

  pool.liquidityProvidersList = liquidityProvidersList;

  pool.save();
}

export function handleCrpTransfer(event: CrpTransfer): void {
  let crp = ConfigurableRightsPool.bind(event.address);
  let poolId = getCrpUnderlyingPool(crp);

  let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  let isMint = event.params.from.toHex() == ZERO_ADDRESS;
  let isBurn = event.params.to.toHex() == ZERO_ADDRESS;

  let poolShareFromId = poolId.concat("-").concat(event.params.from.toHex());
  let poolShareFrom = PoolShare.load(poolShareFromId);
  let poolShareFromBalance =
    poolShareFrom == null ? ZERO_BD : poolShareFrom.balance;

  let poolShareToId = poolId.concat("-").concat(event.params.to.toHex());
  let poolShareTo = PoolShare.load(poolShareToId);
  let poolShareToBalance = poolShareTo == null ? ZERO_BD : poolShareTo.balance;

  let pool = Pool.load(poolId);
  let liquidityProvidersList = pool.liquidityProvidersList || [];
  let transferAmount = tokenToDecimal(event.params.value.toBigDecimal(), 18);

  if (isMint) {
    if (poolShareTo == null) {
      createPoolShareEntity(poolShareToId, poolId, event.params.to.toHex());
      poolShareTo = PoolShare.load(poolShareToId);
      liquidityProvidersList.push(event.params.to);
    }
    poolShareTo.balance = poolShareTo.balance.plus(transferAmount);
    poolShareTo.save();
    pool.totalShares = pool.totalShares.plus(transferAmount);
  } else if (isBurn) {
    if (poolShareFrom == null) {
      createPoolShareEntity(poolShareFromId, poolId, event.params.from.toHex());
      poolShareFrom = PoolShare.load(poolShareFromId);
      liquidityProvidersList.push(event.params.from);
    }

    let burnedSwapFee = poolShareFrom.balance;
    let ratio = ONE_BD;
    if (poolShareFrom.balance.gt(ZERO_BD)) {
      burnedSwapFee = poolShareFrom.swapFee
        .times(transferAmount)
        .div(poolShareFrom.balance);
      ratio = transferAmount.div(poolShareFrom.balance);
    }
    poolShareFrom.swapFee = poolShareFrom.swapFee.minus(burnedSwapFee);
    transferLoss(poolId, event.block.number, poolShareFromId, ratio, null);

    poolShareFrom.balance = poolShareFrom.balance.minus(transferAmount);
    poolShareFrom.save();
    pool.totalShares = pool.totalShares.minus(transferAmount);
  } else {
    if (poolShareFrom == null) {
      createPoolShareEntity(poolShareFromId, poolId, event.params.from.toHex());
      poolShareFrom = PoolShare.load(poolShareFromId);
      liquidityProvidersList.push(event.params.from);
    }
    let burnedSwapFee = poolShareFrom.balance;
    let ratio = ONE_BD;
    if (poolShareFrom.balance.gt(ZERO_BD)) {
      burnedSwapFee = poolShareFrom.swapFee
        .times(transferAmount)
        .div(poolShareFrom.balance);
      ratio = transferAmount.div(poolShareFrom.balance);
    }
    poolShareFrom.swapFee = poolShareFrom.swapFee.minus(burnedSwapFee);
    poolShareFrom.balance = poolShareFrom.balance.minus(transferAmount);
    poolShareFrom.save();

    if (poolShareTo == null) {
      createPoolShareEntity(poolShareToId, poolId, event.params.to.toHex());
      poolShareTo = PoolShare.load(poolShareToId);
      liquidityProvidersList.push(event.params.to);
    }
    poolShareTo.swapFee = poolShareTo.swapFee.plus(burnedSwapFee);
    poolShareTo.balance = poolShareTo.balance.plus(transferAmount);
    poolShareTo.save();

    transferLoss(
      poolId,
      event.block.number,
      poolShareFromId,
      ratio,
      poolShareToId
    );
  }

  if (
    poolShareTo !== null &&
    poolShareTo.balance.notEqual(ZERO_BD) &&
    poolShareToBalance.equals(ZERO_BD)
  ) {
    pool.holdersCount = pool.holdersCount.plus(BigInt.fromI32(1));
  }

  if (
    poolShareFrom !== null &&
    poolShareFrom.balance.equals(ZERO_BD) &&
    poolShareFromBalance.notEqual(ZERO_BD)
  ) {
    pool.holdersCount = pool.holdersCount.minus(BigInt.fromI32(1));
  }

  pool.liquidityProvidersList = liquidityProvidersList;

  pool.save();
}
