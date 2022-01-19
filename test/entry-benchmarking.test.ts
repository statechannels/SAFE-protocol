import chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { ethers as ethersTypes, Wallet } from "ethers";
import { ethers } from "hardhat";

import { EntryChainEscrow__factory } from "../contract-types/factories/EntryChainEscrow__factory";
import { TestToken__factory } from "../contract-types/factories/TestToken__factory";
import { EntryChainTicketStruct } from "../contract-types/EntryChainEscrow";
import { TicketsWithNonce } from "../src/types";
import { hashTickets, signData } from "../src/utils";
import {
  customerPK,
  distributeEntryChainTokens,
  EntryChainTestSetup,
  getOptimismL1Fee,
  lpPK,
  printScenarioGasUsage,
  ScenarioGasUsage,
  waitForTx,
} from "./utils";

async function createCustomer(): Promise<string> {
  const { entryChainToken } = testSetup;
  const { address } = Wallet.createRandom({}).connect(ethers.provider);
  // We assume the customer currently holds, or has previously held, some of the ERC20 tokens on EntryChain.
  // To simulate this we transfer a small amount of tokens to the customer's address, triggering the initial storage write.
  // This prevents the gas cost of claimBatch including a write to zero storage cost for the first time the customer receives tokens.
  await waitForTx(entryChainToken.transfer(address, 1));

  return address;
}
async function runScenario(
  nonce: number,
  batchSize: number,
  customerMode: "Unique" | "Same"
): Promise<ScenarioGasUsage> {
  const { lpEntryChain } = testSetup;
  const { tickets, signature } = await generateTickets(
    nonce,
    batchSize,
    customerMode
  );
  const transResult = await lpEntryChain.claimBatch(tickets, signature);
  const { gasUsed } = await waitForTx(transResult);
  return {
    totalGasUsed: gasUsed,
    batchSize,
    optimismCost: getOptimismL1Fee(transResult),
  };
}

async function generateTickets(
  startNonce = 0,
  numTickets = 2,
  customerMode: "Unique" | "Same" = "Unique",
  amountOfTokens = 1
): Promise<{
  tickets: EntryChainTicketStruct[];
  signature: ethersTypes.Signature;
}> {
  const tickets: EntryChainTicketStruct[] = [];
  const { entryChainToken } = testSetup;
  let customer = await createCustomer();
  for (let i = 0; i < numTickets; i++) {
    if (customerMode === "Unique") {
      customer = await createCustomer();
    }
    tickets.push({
      entryChainRecipient: customer,
      value: amountOfTokens,
      token: entryChainToken.address,
    });
  }
  const ticketsWithNonce: TicketsWithNonce = {
    startNonce,
    tickets,
  };

  const signature = signData(hashTickets(ticketsWithNonce), lpPK);

  return { tickets, signature };
}

let testSetup: EntryChainTestSetup;

beforeEach(async () => {
  const lpWallet = new ethers.Wallet(lpPK, ethers.provider);
  const customerWallet = new ethers.Wallet(customerPK, ethers.provider);
  const entryChainDeployer = new EntryChainEscrow__factory(lpWallet);

  const tokenDeployer = new TestToken__factory(lpWallet);
  const lpEntryChain = await entryChainDeployer.deploy();

  const tokenBalance = 1_000_000;
  const gasLimit = 30_000_000;

  const entryChainToken = await tokenDeployer.deploy(tokenBalance);

  testSetup = {
    entryChainToken,
    lpEntryChain,
    lpWallet,
    customerWallet,
    tokenBalance,
    gasLimit,
  };

  await distributeEntryChainTokens(testSetup);
});

const benchmarkResults: ScenarioGasUsage[] = [];
it("gas benchmarking", async () => {
  let nonce = 0;

  // The FIRST batch that is claimed on EntryChain incurs a write-to-zero-storage cost, which makes
  // for a counter-intuitive list of results. So, we trigger an initial swap before
  // starting the benchmark
  await runScenario(nonce, 1, "Unique");
  nonce++;

  const benchmarkScenarios = [1, 2, 5, 20, 50, 100];

  for (const batchSize of benchmarkScenarios) {
    benchmarkResults.push(await runScenario(nonce, batchSize, "Unique"));

    nonce += batchSize;
  }
});

after(() => printScenarioGasUsage(benchmarkResults));
