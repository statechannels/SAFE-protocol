import { BigNumber, Contract, Wallet } from "ethers";
import { USE_ERC20 } from "../src/constants";
import { IERC20 } from "../src/contract-types/IERC20";

export type Balances = { alice: BigNumber; bob: BigNumber };

export async function getBalances(
  aliceWallet: Wallet,
  bobWallet: Wallet,
  tokenContract: IERC20
): Promise<Balances> {
  if (!USE_ERC20) {
    const alice = await aliceWallet.getBalance();
    const bob = await bobWallet.getBalance();
    return { alice, bob };
  } else {
    const alice = await tokenContract.balanceOf(aliceWallet.address);
    const bob = await tokenContract.balanceOf(bobWallet.address);
    return { alice, bob };
  }
}
