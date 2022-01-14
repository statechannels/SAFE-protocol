import chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { ethers as ethersTypes, Wallet } from "ethers";
import { ethers } from "hardhat";

import { Entry__factory } from "../contract-types/factories/Entry__factory";
import { TestToken__factory } from "../contract-types/factories/TestToken__factory";
import { EntryTicketStruct } from "../contract-types/Entry";
import { TicketsWithNonce } from "../src/types";
import { hashTickets, signData } from "../src/utils";
import {
  customerPK,
  distributeEntryTokens,
  EntryTestSetup,
  lpPK,
  printScenarioGasUsage,
  ScenarioGasUsage,
  waitForTx,
} from "./utils";

async function createCustomer(): Promise<string> {
  const { entryToken } = testSetup;
  const { address } = Wallet.createRandom({}).connect(ethers.provider);
  // We assume the customer currently holds, or has previously held, some of the ERC20 tokens on Entry.
  // To simulate this we transfer a small amount of tokens to the customer's address, triggering the initial storage write.
  // This prevents the gas cost of claimBatch including a write to zero storage cost for the first time the customer receives tokens.
  await waitForTx(entryToken.transfer(address, 1));

  return address;
}
async function runScenario(
  nonce: number,
  batchSize: number,
  customerMode: "Unique" | "Same"
): Promise<ScenarioGasUsage> {
  const { lpEntry } = testSetup;
  const { tickets, signature } = await generateTickets(
    nonce,
    batchSize,
    customerMode
  );
  const { gasUsed } = await waitForTx(lpEntry.claimBatch(tickets, signature));
  return { totalGasUsed: gasUsed, batchSize };
}

async function generateTickets(
  startNonce = 0,
  numTickets = 2,
  customerMode: "Unique" | "Same" = "Unique",
  amountOfTokens = 1
): Promise<{ tickets: EntryTicketStruct[]; signature: ethersTypes.Signature }> {
  const tickets: EntryTicketStruct[] = [];
  const { entryToken } = testSetup;
  let customer = await createCustomer();
  for (let i = 0; i < numTickets; i++) {
    if (customerMode === "Unique") {
      customer = await createCustomer();
    }
    tickets.push({
      entryRecipient: customer,
      value: amountOfTokens,
      token: entryToken.address,
    });
  }
  const ticketsWithNonce: TicketsWithNonce = {
    startNonce,
    tickets,
  };

  const signature = signData(hashTickets(ticketsWithNonce), lpPK);

  return { tickets, signature };
}

let testSetup: EntryTestSetup;

beforeEach(async () => {
  const lpWallet = new ethers.Wallet(lpPK, ethers.provider);
  const customerWallet = new ethers.Wallet(customerPK, ethers.provider);
  const entryDeployer = new Entry__factory(lpWallet);

  const tokenDeployer = new TestToken__factory(lpWallet);
  const lpEntry = await entryDeployer.deploy();

  const tokenBalance = 1_000_000;
  const gasLimit = 30_000_000;

  const entryToken = await tokenDeployer.deploy(tokenBalance);

  testSetup = {
    entryToken,
    lpEntry,
    lpWallet,
    customerWallet,
    tokenBalance,
    gasLimit,
  };

  await distributeEntryTokens(testSetup);
});

const benchmarkResults: ScenarioGasUsage[] = [];
it("gas benchmarking", async () => {
  let nonce = 0;

  // The FIRST batch that is claimed on Entry incurs a write-to-zero-storage cost, which makes
  // for a counter-intuitive list of results. So, we trigger an initial swap before
  // starting the benchmark
  await runScenario(nonce, 1, "Unique");
  nonce++;

  const benchmarkScenarios = [
    1,
    2,
    5,
    20,
    50,
    86, // THE GAS COST IS ... UNDER 9000!!!
  ];

  for (const batchSize of benchmarkScenarios) {
    benchmarkResults.push(await runScenario(nonce, batchSize, "Unique"));

    nonce += batchSize;
  }
});

after(() => printScenarioGasUsage(benchmarkResults));
