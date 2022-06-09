import {
  BigDecimal,
  BigInt,
  Address,
  dataSource,
} from "@graphprotocol/graph-ts";

export let ZERO = BigInt.fromI32(0);
export let ZERO_BD = BigDecimal.fromString("0");
export let ONE_BD = BigDecimal.fromString("1");

export let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export class AddressByNetwork {
  public bsc: string;
  public chapel: string;
}

let network: string = dataSource.network();

let wethAddressByNetwork: AddressByNetwork = {
  bsc: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  chapel: "0x4fac0386c4045b52756b206db3148201e42b3f62",
};

let usdAddressByNetwork: AddressByNetwork = {
  bsc: "0x55d398326f99059ff775485246999027b3197955", // USDT
  chapel: "0xe2d4098010f4fcd04c11c70d8b322b711ffbdcca",
};

let usdtAddressByNetwork: AddressByNetwork = {
  bsc: "0x55d398326f99059ff775485246999027b3197955",
  chapel: "0xe2d4098010f4fcd04c11c70d8b322b711ffbdcca",
};

let vUSDAddressByNetwork: AddressByNetwork = {
  bsc: "0xb365ab13bc6bd2826a0217a5d3c26c4da9c739ca",
  chapel: "0x5108c124a162221a11181d82889cb4b85251b99e",
};

let vEURAddressByNetwork: AddressByNetwork = {
  bsc: "0xce610182e55b8fabbfbe990811fc546ffb26b5c9",
  chapel: "0x927098c1f03f4f624c2b30f5cc956f0edc175e61",
};

let vTHBAddressByNetwork: AddressByNetwork = {
  bsc: "0x0586a2240013daaa41ec91c4447a0e9e30c4becc",
  chapel: "0x7950d937be6ad204d73345609a3c91259236b139",
};

let vSGDAddressByNetwork: AddressByNetwork = {
  bsc: "0x4bfde56e7eb7ed22cd5fb7c7595d1d11b1414581",
  chapel: "0x4149c3b3807cdc4cb2249f9c4579391a77a93043",
};

let vCHFAddressByNetwork: AddressByNetwork = {
  bsc: "0x805a6d33250c9129b17245b39f4aa9bdac3231c9",
  chapel: "0xf313ca0e69ebd1c5230bf939c46b0e097463fe49",
};

function forNetwork(
  addressByNetwork: AddressByNetwork,
  network: string
): Address {
  if (network == "bsc") {
    return Address.fromString(addressByNetwork.bsc);
  } else if (network == "chapel") {
    return Address.fromString(addressByNetwork.chapel);
  } else {
    return Address.fromString(addressByNetwork.chapel);
  }
}

export let WETH: Address = forNetwork(wethAddressByNetwork, network);
export let USD: Address = forNetwork(usdAddressByNetwork, network);
export let USDT: Address = forNetwork(usdtAddressByNetwork, network);
export let vUSD: Address = forNetwork(vUSDAddressByNetwork, network);
export let vEUR: Address = forNetwork(vEURAddressByNetwork, network);
export let vTHB: Address = forNetwork(vTHBAddressByNetwork, network);
export let vSGD: Address = forNetwork(vSGDAddressByNetwork, network);
export let vCHF: Address = forNetwork(vCHFAddressByNetwork, network);

export let PRICING_ASSETS: Address[] = [
  WETH,
  USDT,
  vUSD,
  vEUR,
  vTHB,
  vSGD,
  vCHF,
];
export let USD_STABLE_ASSETS: Address[] = [vUSD];
