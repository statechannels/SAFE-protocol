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

export type Scenario = ClaimTicketsScenario;

export type ScenarioGasUsage = Scenario & {
  totalGasUsed: BigNumber;
};

export function printScenarioGasUsage(scenarios: ScenarioGasUsage[]) {
  console.log("L1 Claim Tickets Gas Usage");
  const table = new Table({
    head: [
      "Ticket Batch Size",
      "Transfer Type",
      " Average Gas Per Ticket",
      "Total Gas Used",
      "Amount of Tickets Claimed",
    ],
    colAligns: ["right", "left", "right", "right", "right"],
  });
  for (const scenario of scenarios) {
    const averagePerClaim = scenario.totalGasUsed
      .div(scenario.amountOfTickets)
      .toNumber();
    table.push([
      scenario.batchSize,
      scenario.transferType,
      averagePerClaim,
      scenario.totalGasUsed,
      scenario.amountOfTickets,
    ]);
  }
  console.log(table.toString());
}
