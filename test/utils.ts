import Table from "cli-table";
import { BigNumber } from "ethers";

export type ScenarioGasUsage = {
  batchSize: number;
  totalGasUsed: BigNumber;
};

export function printScenarioGasUsage(
  scenarios: ScenarioGasUsage[],
  description = "L1 claimBatch Gas Usage"
) {
  console.log(description);
  const table = new Table({
    head: ["Ticket Batch Size", "Average Gas Per Ticket", "Total Gas Used"],
    colAligns: ["right", "right", "right"],
  });
  for (const scenario of scenarios) {
    const averagePerClaim = scenario.totalGasUsed
      .div(scenario.batchSize)
      .toNumber();
    table.push([scenario.batchSize, averagePerClaim, scenario.totalGasUsed]);
  }
  console.log(table.toString());
}
