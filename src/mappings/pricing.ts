import { Address, BigDecimal, Bytes, BigInt } from "@graphprotocol/graph-ts";
import {
  Balancer,
  LatestPrice,
  Pool,
  PoolHistoricalLiquidity,
  SwapToken,
  TokenPriceV2,
} from "../types/schema";
import { ZERO_BD } from "./helpers";
import { PRICING_ASSETS, USD_STABLE_ASSETS, vUSD } from "./helpers/constants";
import { getTokenPriceId, loadPoolToken } from "./helpers/misc";

export function isPricingAsset(asset: Address): boolean {
  for (let i: i32 = 0; i < PRICING_ASSETS.length; i++) {
    if (PRICING_ASSETS[i] == asset) return true;
  }
  return false;
}

export function updatePoolLiquidityV2(
  poolId: string,
  block: BigInt,
  pricingAsset: Address
): void {
  let pool = Pool.load(poolId);
  if (pool == null) return;

  let tokensList: Bytes[] = pool.tokensList;
  if (tokensList.length < 2) return;

  let phlId = getPoolHistoricalLiquidityId(poolId, pricingAsset, block);
  let phl = new PoolHistoricalLiquidity(phlId);
  phl.poolId = poolId;
  phl.block = block;
  phl.poolTotalShares = pool.totalShares;

  let newPoolLiquidity: BigDecimal = ZERO_BD;

  for (let j: i32 = 0; j < tokensList.length; j++) {
    let tokenAddress: Address = Address.fromString(tokensList[j].toHexString());
    let poolToken = loadPoolToken(poolId, tokenAddress);
    let poolTokenQuantity: BigDecimal = poolToken.balance;

    // compare any new token price with the last price
    let tokenPriceId = getTokenPriceId(
      poolId,
      tokenAddress,
      pricingAsset,
      block
    );
    let tokenPrice = TokenPriceV2.load(tokenPriceId);
    let price: BigDecimal;
    let latestPriceId = getLatestPriceId(tokenAddress, pricingAsset);
    let latestPrice = LatestPrice.load(latestPriceId);

    if (tokenPrice == null && latestPrice != null) {
      price = latestPrice.price;
    }
    // note that we can only meaningfully report liquidity once assets are traded with
    // the pricing asset
    if (tokenPrice) {
      //value in terms of priceableAsset
      price = tokenPrice.price;

      // Possibly update latest price
      if (latestPrice == null) {
        latestPrice = new LatestPrice(latestPriceId);
        latestPrice.asset = tokenAddress;
        latestPrice.pricingAsset = pricingAsset;
      }
      latestPrice.price = price;
      latestPrice.block = block;
      latestPrice.poolId = poolId;
      latestPrice.save();
    }

    // poolToken.liquidity
    let oldPoolTokenLiquidity = poolToken.liquidity;
    let newPoolTokenLiquidity =
      valueInUSD(poolTokenQuantity, tokenAddress) || ZERO_BD;
    poolToken.liquidity = newPoolTokenLiquidity;
    poolToken.save();
    let swapToken = SwapToken.load(tokenAddress.toHexString());
    if (swapToken != null) {
      swapToken.liquidity = swapToken.liquidity
        .minus(oldPoolTokenLiquidity)
        .plus(newPoolTokenLiquidity);
    }
    swapToken.save();
    newPoolLiquidity = newPoolLiquidity.plus(newPoolTokenLiquidity);
  }
  phl.poolLiquidity = newPoolLiquidity;
  if (!pool.totalShares.equals(ZERO_BD)) {
    phl.poolShareValue = newPoolLiquidity.div(pool.totalShares);
  } else {
    phl.poolShareValue = newPoolLiquidity;
  }
  phl.save();

  let oldPoolLiquidity: BigDecimal = pool.liquidity;

  if (newPoolLiquidity && oldPoolLiquidity) {
    let factory = Balancer.load("1");
    let liquidityChange: BigDecimal = newPoolLiquidity.minus(oldPoolLiquidity);
    factory.totalLiquidity = factory.totalLiquidity.plus(liquidityChange);
    factory.save();

    pool.liquidity = newPoolLiquidity;
    pool.save();
  }
}

export function updatePoolLiquidityWithoutBlock(poolId: string): void {
  let pool = Pool.load(poolId);
  if (pool == null) return;

  let tokensList: Bytes[] = pool.tokensList;
  if (tokensList.length < 2) return;
  let newPoolLiquidity: BigDecimal = ZERO_BD;

  for (let j: i32 = 0; j < tokensList.length; j++) {
    let tokenAddress: Address = Address.fromString(tokensList[j].toHexString());
    let poolToken = loadPoolToken(poolId, tokenAddress);
    let poolTokenQuantity: BigDecimal = poolToken.balance;

    // poolToken.liquidity
    let oldPoolTokenLiquidity = poolToken.liquidity;
    let newPoolTokenLiquidity =
      valueInUSD(poolTokenQuantity, tokenAddress) || ZERO_BD;
    poolToken.liquidity = newPoolTokenLiquidity;
    poolToken.save();
    let swapToken = SwapToken.load(tokenAddress.toHexString());
    if (swapToken != null) {
      swapToken.liquidity = swapToken.liquidity
        .minus(oldPoolTokenLiquidity)
        .plus(newPoolTokenLiquidity);
    }
    swapToken.save();
    newPoolLiquidity = newPoolLiquidity.plus(newPoolTokenLiquidity);
  }

  let oldPoolLiquidity: BigDecimal = pool.liquidity;

  if (newPoolLiquidity && oldPoolLiquidity) {
    let factory = Balancer.load("1");
    let liquidityChange: BigDecimal = newPoolLiquidity.minus(oldPoolLiquidity);
    factory.totalLiquidity = factory.totalLiquidity.plus(liquidityChange);
    factory.save();

    pool.liquidity = newPoolLiquidity;
    pool.save();
  }
}

export function valueInUSD(
  value: BigDecimal,
  pricingAsset: Address
): BigDecimal {
  let usdValue: BigDecimal;

  if (isUSDStable(pricingAsset)) {
    usdValue = value;
  } else {
    // convert to USD
    // let pricingAssetInUSDId: string = getLatestPriceId(pricingAsset, USDT);
    let pricingAssetInUSDId: string = getLatestPriceId(pricingAsset, vUSD);
    let pricingAssetInUSD = LatestPrice.load(pricingAssetInUSDId);

    // if (!pricingAssetInUSD) {
    //   pricingAssetInUSDId = getLatestPriceId(pricingAsset, vUSD);
    //   pricingAssetInUSD = LatestPrice.load(pricingAssetInUSDId);
    // }

    if (pricingAssetInUSD) {
      usdValue = value.times(pricingAssetInUSD.price);
    }
  }

  return usdValue;
}

export function getLatestPriceId(
  tokenAddress: Address,
  pricingAsset: Address
): string {
  return tokenAddress
    .toHexString()
    .concat("-")
    .concat(pricingAsset.toHexString());
}

function getPoolHistoricalLiquidityId(
  poolId: string,
  tokenAddress: Address,
  block: BigInt
): string {
  return poolId
    .concat("-")
    .concat(tokenAddress.toHexString())
    .concat("-")
    .concat(block.toString());
}

export function isUSDStable(asset: Address): boolean {
  //for (let pa of PRICING_ASSETS) {
  for (let i: i32 = 0; i < USD_STABLE_ASSETS.length; i++) {
    if (USD_STABLE_ASSETS[i] == asset) return true;
  }
  return false;
}
