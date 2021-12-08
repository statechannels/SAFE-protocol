import Table from "cli-table";
import { BigNumber, Wallet } from "ethers";

import { IERC20 } from "../contract-types/IERC20";

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

export type TransferType = "ERC20" | "ETH";

export type ClaimTicketsScenario = {
  transferType: TransferType;
  batchSize: number;
  amountOfTickets: number;
};

export type ClaimTicketsScenarioGasUsage = ClaimTicketsScenario & {
  totalGasUsed: BigNumber;
};

export function printScenarioGasUsage(
  scenarios: ClaimTicketsScenarioGasUsage[]
) {
  const table = new Table({
    head: [
      "Transfer Type",
      "Total Gas Used",
      "Total Claims",
      "Batch Size",
      " Average Gas Per Claim",
    ],
  });
  for (const scenario of scenarios) {
    const averagePerClaim = scenario.totalGasUsed
      .div(scenario.amountOfTickets)
      .toNumber();
    table.push([
      scenario.transferType,
      scenario.totalGasUsed,
      scenario.amountOfTickets,
      scenario.batchSize,
      averagePerClaim,
    ]);
  }
  console.log(table.toString());
}
