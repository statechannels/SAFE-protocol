import chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { BigNumber } from "ethers";
import { ethers } from "hardhat";

import { TestToken__factory } from "../contract-types/factories/TestToken__factory";
import {
  authorizeWithdrawal,
  customerPK,
  deposit,
  distributeExitChainTokens,
  ExitChainTestSetup,
  getOptimismL1Fee,
  lpPK,
  ScenarioGasUsage,
  waitForTx,
} from "./utils";
import { ExitChainEscrow__factory } from "../contract-types/factories/ExitChainEscrow__factory";
import { SAFETY_DELAY } from "../src/constants";
import Table from "cli-table";

type ExitChainScenarioGasUsage = ScenarioGasUsage & {
  type: "depositOnExitChain" | "authorizeWithdrawal" | "claimExitChainFunds";
};

const gasLimit = 30_000_000;
const tokenBalance = 1_000_000;

const customerWallet = new ethers.Wallet(customerPK, ethers.provider);
const lpWallet = new ethers.Wallet(lpPK, ethers.provider);

const exitChainDeployer = new ExitChainEscrow__factory(lpWallet);
const tokenDeployer = new TestToken__factory(lpWallet);
let testSetup: ExitChainTestSetup;

export function printExitScenarioGasUsage(
  scenarios: ExitChainScenarioGasUsage[]
) {
  console.log("Exit chain Gas Usage");
  const table = new Table({
    head: [
      "Ticket Batch Size",
      "Exit Contract Function",
      "Average Gas Per Call",
      "Average Optimism L1 Fee Per Call",
    ],
    colAligns: ["right", "right", "right"],
  });

  for (const scenario of scenarios) {
    const gasPerCall =
      scenario.type === "depositOnExitChain"
        ? scenario.totalGasUsed.div(scenario.batchSize)
        : scenario.totalGasUsed;
    const optimismCostPerCall =
      scenario.type === "depositOnExitChain"
        ? scenario.optimismCost.div(scenario.batchSize)
        : scenario.optimismCost;
    table.push([
      scenario.batchSize,
      scenario.type,
      gasPerCall.toNumber(),
      optimismCostPerCall.toNumber(),
    ]);
  }
  console.log(table.toString());
}

async function runScenario(
  batchSize: number,
  trustedNonce: number
): Promise<ExitChainScenarioGasUsage[]> {
  const results: ExitChainScenarioGasUsage[] = [];

  const trustedAmount = 10000;

  let totalDepositGas = BigNumber.from(0);
  let totalDepositOptimismFee = BigNumber.from(0);

  for (let i = 0; i < batchSize; i++) {
    const { gasUsed, optimismL1Fee } = await deposit(
      testSetup,
      trustedNonce,
      trustedAmount
    );

    totalDepositGas = totalDepositGas.add(gasUsed);
    totalDepositOptimismFee = totalDepositOptimismFee.add(optimismL1Fee);
  }

  results.push({
    type: "depositOnExitChain",
    batchSize,
    totalGasUsed: totalDepositGas,
    optimismCost: totalDepositOptimismFee,
  });

  const { lpExitChain } = testSetup;
  const authorizeResults = await authorizeWithdrawal(
    testSetup,
    trustedNonce,
    batchSize
  );

  results.push({
    type: "authorizeWithdrawal",
    batchSize,
    totalGasUsed: authorizeResults.gasUsed,
    optimismCost: authorizeResults.optimismL1Fee,
  });
  await ethers.provider.send("evm_increaseTime", [SAFETY_DELAY + 1]);

  const claimResult = await lpExitChain.claimExitChainFunds(trustedNonce);
  const claimReceipt = await waitForTx(claimResult);
  results.push({
    type: "claimExitChainFunds",
    batchSize,
    totalGasUsed: claimReceipt.gasUsed,
    optimismCost: getOptimismL1Fee(claimResult),
  });
  return results;
}

beforeEach(async () => {
  const exitChainToken = await tokenDeployer.deploy(tokenBalance);
  const entryChainTokenAddress = ethers.Wallet.createRandom().address;

  const exitChain = await exitChainDeployer.deploy();

  await exitChain.registerTokenPairs([
    {
      entryChainToken: entryChainTokenAddress,

      exitChainToken: exitChainToken.address,
    },
  ]);
  const customerExitChain = exitChain.connect(customerWallet);

  const lpExitChain = exitChain.connect(lpWallet);

  testSetup = {
    lpExitChain,
    lpWallet,
    gasLimit,
    customerExitChain,
    exitChainToken,

    customerWallet,
    tokenBalance,
  };

  await distributeExitChainTokens(testSetup);
});

const benchmarkResults: ExitChainScenarioGasUsage[] = [];
it("gas benchmarking", async () => {
  let nonce = 0;
  // Perform an initial scenario run to
  await runScenario(1, nonce);
  nonce++;
  const benchmarkScenarios = [1, 2, 5, 20, 50, 100];

  for (const batchSize of benchmarkScenarios) {
    benchmarkResults.push(...(await runScenario(batchSize, nonce)));
    nonce += batchSize;
  }
}).timeout(60_000);

after(() => printExitScenarioGasUsage(benchmarkResults));
