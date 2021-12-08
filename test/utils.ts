import { BigNumber, Contract, Wallet } from "ethers";

import { IERC20 } from "../contract-types/IERC20";
import { TransferType } from "./l1.test";

export type Balances = { alice: BigNumber; bob: BigNumber };

export async function getBalances(
  aliceWallet: Wallet,
  bobWallet: Wallet,
  tokenContract: IERC20,
  transferType: TransferType
): Promise<Balances> {
  if (transferType === "ETH") {
    const alice = await aliceWallet.getBalance();
    const bob = await bobWallet.getBalance();
    return { alice, bob };
  } else {
    const alice = await tokenContract.balanceOf(aliceWallet.address);
    const bob = await tokenContract.balanceOf(bobWallet.address);

    return { alice, bob };
  }
}
