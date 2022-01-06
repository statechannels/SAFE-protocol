import chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { ethers as ethersTypes, Wallet } from "ethers";
import { ethers } from "hardhat";

import { L1__factory } from "../contract-types/factories/L1__factory";
import { TestToken__factory } from "../contract-types/factories/TestToken__factory";
import { TestToken } from "../contract-types/TestToken";
import { L1, TicketStruct } from "../contract-types/L1";
import { TicketsWithNonce } from "../src/types";
import { hashTickets, signData } from "../src/utils";
import {
  lpPK,
  printScenarioGasUsage,
  ScenarioGasUsage,
  waitForTx,
} from "./utils";

async function createCustomer(): Promise<string> {
  const { address } = Wallet.createRandom({}).connect(ethers.provider);
  // We assume that the customer has interacted with the token contract before
  // To simulate this we transfer a small amount, triggering the write to zero storage.
  // This prevents the gas cost of claimBatch including a write to zero storage.
  // TODO: Is it realistic to just do this for all customers?
  await testToken.transfer(address, 1);

  return address;
}
async function generateTickets(
  startNonce = 0,
  numTickets = 2,
  numCustomers: number | "Unique" = 1,
  amountOfTokens = 1
): Promise<{ tickets: TicketStruct[]; signature: ethersTypes.Signature }> {
  const tickets: TicketStruct[] = [];
  const customers: string[] = [];
  for (let i = 0; i < numCustomers; i++) {
    customers.push(await createCustomer());
  }

  for (let i = 0; i < numTickets; i++) {
    let customer: string;
    // Generate a new untouched address for
    if (numCustomers === "Unique") {
      customer = await createCustomer();
    } else {
      customer = customers[Math.floor(Math.random() * customers.length)];
    }
    tickets.push({
      l1Recipient: customer,
      value: amountOfTokens,
      token: testToken.address,
      createdAt: Math.round(Date.now() / 1000),
    });
  }
  const ticketsWithNonce: TicketsWithNonce = {
    startNonce,
    tickets,
  };

  const signature = signData(hashTickets(ticketsWithNonce), lpPK);

  return { tickets, signature };
}

let l1Contract: L1;

let testToken: TestToken;

beforeEach(async () => {
  const lpWallet = new ethers.Wallet(lpPK, ethers.provider);

  const l1Deployer = new L1__factory(lpWallet);

  const tokenDeployer = new TestToken__factory(lpWallet);
  l1Contract = await l1Deployer.deploy();

  const tokenBalance = 1_000_000;

  testToken = await tokenDeployer.deploy(tokenBalance);

  // Transfer 1/4 to the l1 contract for payouts
  await testToken.transfer(l1Contract.address, tokenBalance / 4);

  await testToken.approve(l1Contract.address, tokenBalance);
});

const benchmarkResults: ScenarioGasUsage[] = [];
it.only("gas benchmarking", async () => {
  let nonce = 0;
  const initial = await generateTickets(0, 1, 1, 1);
  // The FIRST batch that is claimed on L1 incurs a write-to-zero-storage cost, which makes
  // for a counter-intuitive list of results. So, we trigger an initial swap before
  // starting the benchmark

  await waitForTx(l1Contract.claimBatch(initial.tickets, initial.signature));

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
    benchmarkResults.push(await runScenario(nonce, batchSize, "Same"));
    nonce += batchSize;
    benchmarkResults.push(await runScenario(nonce, batchSize, "Unique"));
    nonce += batchSize;
  }
});

async function runScenario(
  nonce: number,
  batchSize: number,
  customerMode: "Unique" | "Same"
): Promise<ScenarioGasUsage> {
  const { tickets, signature } = await generateTickets(
    nonce,
    batchSize,
    customerMode === "Unique" ? "Unique" : 1
  );
  const { gasUsed } = await waitForTx(
    l1Contract.claimBatch(tickets, signature)
  );
  return { totalGasUsed: gasUsed, batchSize, customer: customerMode };
}

after(() => printScenarioGasUsage(benchmarkResults));
