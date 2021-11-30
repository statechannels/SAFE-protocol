import { BigNumber, Wallet } from "ethers";

export type Balances = { alice: BigNumber; bob: BigNumber };

export async function getBalances(
  aliceWallet: Wallet,
  bobWallet: Wallet
): Promise<Balances> {
  const alice = await aliceWallet.getBalance();
  const bob = await bobWallet.getBalance();
  return { alice, bob };
}
