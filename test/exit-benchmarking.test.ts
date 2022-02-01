import chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { BigNumber, Wallet } from "ethers";
import { ethers } from "hardhat";

import { TestToken__factory } from "../contract-types/factories/TestToken__factory";
import {
  authorizeWithdrawal,
  createCustomer,
  customerPK,
  deposit,
  FromChainTestSetup,
  lpPK,
  ScenarioGasUsage,
  waitForTx,
} from "./utils";
import { FromChainEscrow__factory } from "../contract-types/factories/FromChainEscrow__factory";
import { SAFETY_DELAY } from "../src/constants";
import Table from "cli-table";
import { TokenPairStruct } from "../contract-types/FromChainEscrow";
import { TestToken } from "../contract-types/TestToken";
import { getOptimismL1Fee } from "./gas-utils";

type FromChainScenarioGasUsage = ScenarioGasUsage & {
  type: "depositOnFromChain" | "authorizeWithdrawal" | "claimFromChainFunds";
};

const gasLimit = 30_000_000;
const tokenBalance = 1_000_000;
const amountOfTokenContracts = 5;

const customerWallet = new ethers.Wallet(customerPK, ethers.provider);
const lpWallet = new ethers.Wallet(lpPK, ethers.provider);

const fromChainDeployer = new FromChainEscrow__factory(lpWallet);
const tokenDeployer = new TestToken__factory(lpWallet);
let testSetup: FromChainTestSetup;

export function printFromScenarioGasUsage(
  scenarios: FromChainScenarioGasUsage[]
) {
  console.log("From chain Gas Usage");
  const table = new Table({
    head: [
      "Ticket Batch Size",
      "From Contract Function",
      "Total Gas",
      "Average Gas Per Call",
      "Total Optimism L1 Fee",
      "Average Optimism L1 Fee Per Call",
    ],
    colAligns: ["right", "right", "right"],
  });

  for (const scenario of scenarios) {
    const gasPerCall =
      scenario.type === "depositOnFromChain"
        ? scenario.totalGasUsed.div(scenario.batchSize)
        : scenario.totalGasUsed;
    const optimismCostPerCall =
      scenario.type === "depositOnFromChain"
        ? scenario.optimismCost.div(scenario.batchSize)
        : scenario.optimismCost;
    table.push([
      scenario.batchSize,
      scenario.type,
      scenario.totalGasUsed.toNumber(),
      gasPerCall.toNumber(),
      scenario.optimismCost.toNumber(),
      optimismCostPerCall.toNumber(),
    ]);
  }
  console.log(table.toString());
}

async function runScenario(
  nonce: number,
  batchSize: number,
  customerMode: "Unique" | "Same"
): Promise<FromChainScenarioGasUsage[]> {
  const results: FromChainScenarioGasUsage[] = [];

  const trustedAmount = 10000;

  let totalDepositGas = BigNumber.from(0);
  let totalDepositOptimismFee = BigNumber.from(0);
  const sameCustomer = await createCustomer(
    testSetup.lpWallet,
    testSetup.lpFromChain.address,
    tokens
  );
  const customers = [];

  for (let i = 0; i < batchSize; i++) {
    if (customerMode === "Unique") {
      customers.push(
        await createCustomer(
          testSetup.lpWallet,
          testSetup.lpFromChain.address,
          tokens
        )
      );
    } else {
      customers.push(sameCustomer);
    }
  }

  for (let i = 0; i < batchSize; i++) {
    // Pick a random token from our token list and deposit with that
    const randomToken = tokens[Math.floor(Math.random() * tokens.length)];
    const { gasUsed, optimismL1Fee } = await deposit(
      {
        ...testSetup,
        fromChainToken: randomToken.contract,
        customerFromChain: testSetup.lpFromChain.connect(customers[i]),
      },
      nonce + i, // This means the trusted nonce is just the nonce of the previous ticket
      trustedAmount
    );

    totalDepositGas = totalDepositGas.add(gasUsed);
    totalDepositOptimismFee = totalDepositOptimismFee.add(optimismL1Fee);
  }

  results.push({
    type: "depositOnFromChain",
    batchSize,
    totalGasUsed: totalDepositGas,
    optimismCost: totalDepositOptimismFee,
  });

  const { lpFromChain } = testSetup;
  const authorizeResults = await authorizeWithdrawal(
    testSetup,
    nonce,
    batchSize
  );

  results.push({
    type: "authorizeWithdrawal",
    batchSize,
    totalGasUsed: authorizeResults.gasUsed,
    optimismCost: authorizeResults.optimismL1Fee,
  });
  // Increase the time on the chain so we can claim funds
  await ethers.provider.send("evm_increaseTime", [SAFETY_DELAY + 1]);

  const claimTransaction = await lpFromChain.claimFromChainFunds(nonce);
  const claimReceipt = await waitForTx(claimTransaction);
  results.push({
    type: "claimFromChainFunds",
    batchSize,
    totalGasUsed: claimReceipt.gasUsed,
    optimismCost: getOptimismL1Fee(claimTransaction),
  });
  return results;
}

const tokens: Array<{ pair: TokenPairStruct; contract: TestToken }> = [];

describe("from benchmarking", () => {
  beforeEach(async () => {
    const fromChain = await fromChainDeployer.deploy();

    for (let i = 0; i < amountOfTokenContracts; i++) {
      // Deploy a new token contract
      const contract = await tokenDeployer.deploy(tokenBalance);
      // Use a random address for it's pair since it represents an address on a different chain
      const randomAddress = Wallet.createRandom().address;
      const pair = {
        fromChainToken: contract.address,
        toChainToken: randomAddress,
      };
      tokens.push({ pair, contract });

      // Transfer the token to the from chain contract so it is "warmed" up
      await waitForTx(contract.transfer(fromChain.address, 1));
    }

    // Register all the token pairs we just created
    await fromChain.registerTokenPairs(tokens.map((t) => t.pair));

    const customerFromChain = fromChain.connect(customerWallet);
    const lpFromChain = fromChain.connect(lpWallet);

    testSetup = {
      lpFromChain,
      lpWallet,
      gasLimit,
      customerFromChain,
      fromChainToken: tokens[0].contract,
      customerWallet,
      tokenBalance,
    };
  });

  const benchmarkResults: FromChainScenarioGasUsage[] = [];
  it("from gas benchmarking", async () => {
    let nonce = 0;
    // Perform an initial scenario run to
    await runScenario(nonce, 1, "Same");
    nonce++;

    const benchmarkScenarios = [1, 5, 20];

    for (const batchSize of benchmarkScenarios) {
      benchmarkResults.push(...(await runScenario(nonce, batchSize, "Same")));
      nonce += batchSize;
    }
  }).timeout(60_000);

  after(() => printFromScenarioGasUsage(benchmarkResults));
});
