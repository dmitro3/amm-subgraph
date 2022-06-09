import {
  BigDecimal,
  Address,
  BigInt,
  Bytes,
  dataSource,
  ethereum,
} from "@graphprotocol/graph-ts";
import {
  Pool,
  User,
  PoolToken,
  PoolShare,
  TokenPrice,
  Transaction,
  Balancer,
  SwapToken,
} from "../types/schema";
import { BTokenBytes } from "../types/templates/Pool/BTokenBytes";
import { BToken } from "../types/templates/Pool/BToken";
import { CRPFactory } from "../types/Factory/CRPFactory";
import { ConfigurableRightsPool } from "../types/Factory/ConfigurableRightsPool";
import { BPoolExtension } from "../types/Factory/BPoolExtension";
import {
  WETH as WETHAddress,
  USDT as USDTAddress,
  vUSD as VUSDAddress,
  vTHB as VTHBAddress,
  vEUR as vEURAddress,
  vCHF as vCHFAddress,
  vSGD as vSGDAddress,
} from "./helpers/constants";

export let ZERO_BD = BigDecimal.fromString("0");

let network = dataSource.network();

// Config for mainnet
let WETH = WETHAddress.toHexString();
let USD = USDTAddress.toHexString();
let DAI = "0x1cd44dea31f43ac8b448bd6c860f3434ec9c2f37";
let vUSD = VUSDAddress.toHexString();
let vTHB = VTHBAddress.toHexString();
let vEUR = vEURAddress.toHexString();
let vCHF = vCHFAddress.toHexString();
let vSGD = vSGDAddress.toHexString();
let CRP_FACTORY = "0x3a22C1079fc4F6E2b784D4A182d0E63dedC3213D";

if (network == "chapel") {
  DAI = "0x3972aebcec8fae45e2bdc06fd30167eafa5bce38"; // DAI
  CRP_FACTORY = "0x3a22C1079fc4F6E2b784D4A182d0E63dedC3213D";
}

if (network == "bsc") {
  DAI = "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3"; // DAI
  CRP_FACTORY = "0x704876DFF2C4eba7408a97bD47Dc37C81817fC96";
}

export const ADMIN_ROLE =
  "0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775";
export const RESTRICTED_ROLE =
  "0xa0962abd2c4b5637166310be8994eed908f58b5b5396ff129d47c68a40bd22be";
export const UNRESTRICTED_ROLE =
  "0xf1ace51d64be07e49551907f704b17a27f35380de69c40bb47b25cccef03fe1e";

export function hexToDecimal(hexString: string, decimals: i32): BigDecimal {
  let bytes = Bytes.fromHexString(hexString).reverse() as Bytes;
  let bi = BigInt.fromUnsignedBytes(bytes);
  let scale = BigInt.fromI32(10)
    .pow(decimals as u8)
    .toBigDecimal();
  return bi.divDecimal(scale);
}

export function bigIntToDecimal(amount: BigInt, decimals: i32): BigDecimal {
  let scale = BigInt.fromI32(10)
    .pow(decimals as u8)
    .toBigDecimal();
  return amount.toBigDecimal().div(scale);
}

export function tokenToDecimal(amount: BigDecimal, decimals: i32): BigDecimal {
  let scale = BigInt.fromI32(10)
    .pow(decimals as u8)
    .toBigDecimal();
  return amount.div(scale);
}

export function createPoolShareEntity(
  id: string,
  poolId: string,
  user: string
): void {
  let poolShare = new PoolShare(id);

  createUserEntity(user);

  poolShare.userAddress = user;
  poolShare.poolId = poolId;
  poolShare.balance = ZERO_BD;
  poolShare.swapFee = ZERO_BD;
  poolShare.loss = ZERO_BD;
  poolShare.save();
}

export function createPoolTokenEntity(
  id: string,
  pool: string,
  address: string
): void {
  let token = BToken.bind(Address.fromString(address));
  let tokenBytes = BTokenBytes.bind(Address.fromString(address));
  let symbol = "";
  let name = "";
  let decimals = 18;

  // COMMENT THE LINES BELOW OUT FOR LOCAL DEV ON KOVAN

  let symbolCall = token.try_symbol();
  let nameCall = token.try_name();
  let decimalCall = token.try_decimals();

  if (symbolCall.reverted) {
    let symbolBytesCall = tokenBytes.try_symbol();
    if (!symbolBytesCall.reverted) {
      symbol = symbolBytesCall.value.toString();
    }
  } else {
    symbol = symbolCall.value;
  }

  if (nameCall.reverted) {
    let nameBytesCall = tokenBytes.try_name();
    if (!nameBytesCall.reverted) {
      name = nameBytesCall.value.toString();
    }
  } else {
    name = nameCall.value;
  }

  if (!decimalCall.reverted) {
    decimals = decimalCall.value;
  }

  // COMMENT THE LINES ABOVE OUT FOR LOCAL DEV ON KOVAN

  // !!! COMMENT THE LINES BELOW OUT FOR NON-LOCAL DEPLOYMENT
  // This code allows Symbols to be added when testing on local Kovan
  /*
  if(address == '0xd0a1e359811322d97991e03f863a0c30c2cf029c')
    symbol = 'WETH';
  else if(address == '0x1528f3fcc26d13f7079325fb78d9442607781c8c')
    symbol = 'DAI'
  else if(address == '0xef13c0c8abcaf5767160018d268f9697ae4f5375')
    symbol = 'MKR'
  else if(address == '0x2f375e94fc336cdec2dc0ccb5277fe59cbf1cae5')
    symbol = 'USDC'
  else if(address == '0x1f1f156e0317167c11aa412e3d1435ea29dc3cce')
    symbol = 'BAT'
  else if(address == '0x86436bce20258a6dcfe48c9512d4d49a30c4d8c4')
    symbol = 'SNX'
  else if(address == '0x8c9e6c40d3402480ace624730524facc5482798c')
    symbol = 'REP'
  */
  // !!! COMMENT THE LINES ABOVE OUT FOR NON-LOCAL DEPLOYMENT

  let poolToken = new PoolToken(id);
  poolToken.poolId = pool;
  poolToken.address = address;
  poolToken.name = name;
  poolToken.symbol = symbol;
  poolToken.decimals = decimals;
  poolToken.balance = ZERO_BD;
  poolToken.denormWeight = ZERO_BD;
  poolToken.liquidity = ZERO_BD;
  poolToken.save();
}

/// @deprecated
export function updateSwapTokenLiquidity(tokenId: string): void {
  let swapToken = SwapToken.load(tokenId);
  if (swapToken == null) {
    return;
  }

  let poolLists = swapToken.poolsList;
  let liquidity = ZERO_BD;
  for (let i: i32 = 0; i < poolLists.length; i++) {
    let poolId = poolLists[i].toHexString();
    let poolTokenId = poolId.concat("-").concat(tokenId);
    let poolToken = PoolToken.load(poolTokenId);

    if (poolToken !== null) {
      liquidity = liquidity.plus(poolToken.liquidity);
    }
  }

  swapToken.liquidity = liquidity;
  swapToken.save();
}

export function getTokensLiquidity(tokenIds: string[]): BigDecimal {
  let liquidity = ZERO_BD;
  for (let i: i32 = 0; i < tokenIds.length; i++) {
    let tokenId = tokenIds[i];
    let swapToken = SwapToken.load(tokenId);
    if (swapToken !== null) {
      liquidity = liquidity.plus(swapToken.liquidity);
    }
  }

  return liquidity;
}

export function decrPoolCount(
  active: boolean,
  finalized: boolean,
  crp: boolean
): void {
  if (active) {
    let factory = Balancer.load("1");
    factory.poolCount = factory.poolCount - 1;
    if (finalized) factory.finalizedPoolCount = factory.finalizedPoolCount - 1;
    if (crp) factory.crpCount = factory.crpCount - 1;
    factory.save();
  }
}

export function saveTransaction(
  event: ethereum.Event,
  eventName: string
): void {
  let tx = event.transaction.hash
    .toHexString()
    .concat("-")
    .concat(event.logIndex.toString());
  let userAddress = event.transaction.from.toHex();
  let transaction = Transaction.load(tx);
  if (transaction == null) {
    transaction = new Transaction(tx);
  }
  transaction.event = eventName;
  transaction.poolAddress = event.address.toHex();
  transaction.userAddress = userAddress;
  transaction.gasUsed = event.transaction.gasUsed.toBigDecimal();
  transaction.gasPrice = event.transaction.gasPrice.toBigDecimal();
  transaction.tx = event.transaction.hash;
  transaction.timestamp = event.block.timestamp.toI32();
  transaction.block = event.block.number.toI32();
  transaction.save();

  createUserEntity(userAddress);
}

export function createUserEntity(address: string): void {
  if (User.load(address) == null) {
    let user = new User(address);
    user.save();
  }
}

export function isCrp(address: Address): boolean {
  let crpFactory = CRPFactory.bind(Address.fromString(CRP_FACTORY));
  let isCrp = crpFactory.try_isCrp(address);
  if (isCrp.reverted) return false;
  return isCrp.value;
}

export function getCrpUnderlyingPool(
  crp: ConfigurableRightsPool
): string | null {
  let bPool = crp.try_bPool();
  if (bPool.reverted) return null;
  return bPool.value.toHexString();
}

export function getCrpController(crp: ConfigurableRightsPool): string | null {
  let controller = crp.try_getController();
  if (controller.reverted) return null;
  return controller.value.toHexString();
}

export function getCrpSymbol(crp: ConfigurableRightsPool): string {
  let symbol = crp.try_symbol();
  if (symbol.reverted) return "";
  return symbol.value;
}

export function getCrpName(crp: ConfigurableRightsPool): string {
  let name = crp.try_name();
  if (name.reverted) return "";
  return name.value;
}

export function getCrpCap(crp: ConfigurableRightsPool): BigInt {
  let cap = crp.try_getCap();
  if (cap.reverted) return BigInt.fromI32(0);
  return cap.value;
}

export function getCrpRights(crp: ConfigurableRightsPool): string[] {
  let rights = crp.try_rights();
  if (rights.reverted) return [];
  let rightsArr: string[] = [];
  if (rights.value.value0) rightsArr.push("canPauseSwapping");
  if (rights.value.value1) rightsArr.push("canChangeSwapFee");
  if (rights.value.value2) rightsArr.push("canChangeWeights");
  if (rights.value.value3) rightsArr.push("canAddRemoveTokens");
  if (rights.value.value4) rightsArr.push("canWhitelistLPs");
  if (rights.value.value5) rightsArr.push("canChangeCap");
  if (rights.value.value6) rightsArr.push("canChangeProtocolFee");
  return rightsArr;
}

export function getPoolRoles(address: Address): Array<boolean> {
  let admin = false;
  let restricted = false;
  let unrestricted = false;
  let pool = BPoolExtension.bind(address);

  let getRoles = pool.try_getRoles();
  if (getRoles.reverted) {
    return [admin, restricted, unrestricted];
  }
  let roles = getRoles.value;

  admin = roles.includes(Address.fromHexString(ADMIN_ROLE) as Bytes);
  restricted = roles.includes(Address.fromHexString(RESTRICTED_ROLE) as Bytes);
  unrestricted = roles.includes(Address.fromHexString(
    UNRESTRICTED_ROLE
  ) as Bytes);
  return [admin, restricted, unrestricted];
}
