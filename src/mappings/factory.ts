import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { LOG_NEW_POOL } from "../types/Factory/Factory";
import { Balancer, Pool } from "../types/schema";
import {
  Pool as PoolContract,
  CrpController as CrpControllerContract,
} from "../types/templates";
import {
  ZERO_BD,
  isCrp,
  getCrpController,
  getCrpSymbol,
  getCrpName,
  getCrpRights,
  getCrpCap,
  getPoolRoles,
  ADMIN_ROLE,
  RESTRICTED_ROLE,
  UNRESTRICTED_ROLE,
} from "./helpers";
import { ConfigurableRightsPool } from "../types/Factory/ConfigurableRightsPool";
import { BPoolExtension } from "../types/Factory/BPoolExtension";

export function handleNewPool(event: LOG_NEW_POOL): void {
  let factory = Balancer.load("1");

  // if no factory yet, set up blank initial
  if (factory == null) {
    factory = new Balancer("1");
    factory.color = "Bronze";
    factory.poolCount = 0;
    factory.finalizedPoolCount = 0;
    factory.crpCount = 0;
    factory.txCount = BigInt.fromI32(0);
    factory.totalLiquidity = ZERO_BD;
    factory.totalSwapVolume = ZERO_BD;
    factory.totalSwapFee = ZERO_BD;
    factory.totalProtocolFee = ZERO_BD;
    factory.totalNetFee = ZERO_BD;
  }

  let pool = new Pool(event.params.pool.toHexString());
  pool.crp = isCrp(event.params.caller);
  pool.rights = [];
  if (pool.crp) {
    factory.crpCount += 1;
    let crp = ConfigurableRightsPool.bind(event.params.caller);
    pool.symbol = getCrpSymbol(crp);
    pool.name = getCrpName(crp);
    pool.crpController = Address.fromString(getCrpController(crp));
    pool.rights = getCrpRights(crp);
    pool.cap = getCrpCap(crp);

    // Listen for any future crpController changes.
    CrpControllerContract.create(event.params.caller);
  }
  pool.controller = event.params.caller;
  pool.publicSwap = false;
  pool.finalized = false;
  pool.active = true;
  pool.swapFee = ZERO_BD;
  pool.protocolFee = ZERO_BD;
  pool.totalWeight = ZERO_BD;
  pool.totalShares = ZERO_BD;
  pool.totalSwapVolume = ZERO_BD;
  pool.totalSwapFee = ZERO_BD;
  pool.totalProtocolFee = ZERO_BD;
  pool.netFee = ZERO_BD;
  pool.liquidity = ZERO_BD;
  pool.totalNetFee = ZERO_BD;
  pool.createTime = event.block.timestamp.toI32();
  pool.tokensCount = BigInt.fromI32(0);
  pool.holdersCount = BigInt.fromI32(0);
  pool.joinsCount = BigInt.fromI32(0);
  pool.exitsCount = BigInt.fromI32(0);
  pool.swapsCount = BigInt.fromI32(0);
  pool.factoryID = event.address.toHexString();
  pool.tokensList = [];
  pool.liquidityProvidersList = [];
  pool.tx = event.transaction.hash;
  pool.admin = false;
  pool.restricted = false;
  pool.unrestricted = false;
  let roles = getPoolRoles(event.params.pool);
  pool.admin = roles[0];
  pool.restricted = roles[1];
  pool.unrestricted = roles[2];
  pool.totalAddVolume = ZERO_BD;
  pool.totalWithdrawVolume = ZERO_BD;
  pool.save();

  factory.poolCount = factory.poolCount + 1;
  factory.save();

  PoolContract.create(event.params.pool);
}
