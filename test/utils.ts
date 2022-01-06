import Table from "cli-table";
import { BigNumber } from "ethers";
import { ethers as ethersTypes } from "ethers";

export type ScenarioGasUsage = {
  batchSize: number;
  totalGasUsed: BigNumber;
  customer: "Unique" | "Same";
};

export function printScenarioGasUsage(scenarios: ScenarioGasUsage[]) {
  console.log("L1 claimBatch Gas Usage");
  const table = new Table({
    head: [
      "Ticket Batch Size",
      "Recipients",

      "Average Gas Per Ticket",
      "Total Gas Used",
    ],
    colAligns: ["right", "right", "right"],
  });
  for (const scenario of scenarios) {
    const averagePerClaim = scenario.totalGasUsed
      .div(scenario.batchSize)
      .toNumber();
    table.push([
      scenario.batchSize,
      scenario.customer === "Unique" ? "Unique recipients" : "Same recipient",
      averagePerClaim,
      scenario.totalGasUsed,
    ]);
  }
  console.log(table.toString());
}
// Address 0x2a47Cd5718D67Dc81eAfB24C99d4db159B0e7bCa
export const customerPK =
  "0xe1743f0184b85ac1412311be9d6e5d333df23e22efdf615d0135ca2b9ed67938";
// Address 0x9552ceB4e6FA8c356c1A76A8Bc8b1EFA7B9fb205
export const lpPK =
  "0x23ac17b9c3590a8e67a1d1231ebab87dd2d3389d2f1526f842fd1326a0990f42";

// pk = 0x91f47a1911c0fd985b34c25962f661f0de606f7ad38ba156902dff48b4d05f97
export const customer2Address = "0xAAAB35381A38C4fF4967DC29470F0f2637295983";

export async function waitForTx(
  txPromise: Promise<ethersTypes.providers.TransactionResponse>
) {
  return (await txPromise).wait();
}
