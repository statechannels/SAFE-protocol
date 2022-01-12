import chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { ethers as ethersTypes, Wallet } from "ethers";
import { ethers } from "hardhat";

import { L1__factory } from "../contract-types/factories/L1__factory";
import { TestToken__factory } from "../contract-types/factories/TestToken__factory";
import { L1TicketStruct } from "../contract-types/L1";
import { TicketsWithNonce } from "../src/types";
import { hashTickets, signData } from "../src/utils";
import {
  customerPK,
  distributeL1Tokens,
  L1TestSetup,
  lpPK,
  printScenarioGasUsage,
  ScenarioGasUsage,
  waitForTx,
} from "./utils";

async function createCustomer(): Promise<string> {
  const { l1Token } = testSetup;
  const { address } = Wallet.createRandom({}).connect(ethers.provider);
  // We assume the customer currently holds, or has previously held, some of the ERC20 tokens on L1.
  // To simulate this we transfer a small amount of tokens to the customer's address, triggering the initial storage write.
  // This prevents the gas cost of claimBatch including a write to zero storage cost for the first time the customer receives tokens.
  await l1Token.transfer(address, 1);

  return address;
}
async function runScenario(
  nonce: number,
  batchSize: number,
  customerMode: "Unique" | "Same"
): Promise<ScenarioGasUsage> {
  const { lpL1 } = testSetup;
  const { tickets, signature } = await generateTickets(
    nonce,
    batchSize,
    customerMode
  );
  const { gasUsed } = await waitForTx(lpL1.claimBatch(tickets, signature));
  return { totalGasUsed: gasUsed, batchSize };
}

async function generateTickets(
  startNonce = 0,
  numTickets = 2,
  customerMode: "Unique" | "Same" = "Unique",
  amountOfTokens = 1
): Promise<{ tickets: L1TicketStruct[]; signature: ethersTypes.Signature }> {
  const tickets: L1TicketStruct[] = [];
  const { l1Token } = testSetup;
  let customer = await createCustomer();
  for (let i = 0; i < numTickets; i++) {
    if (customerMode === "Unique") {
      customer = await createCustomer();
    }
    tickets.push({
      l1Recipient: customer,
      value: amountOfTokens,
      token: l1Token.address,
    });
  }
  const ticketsWithNonce: TicketsWithNonce = {
    startNonce,
    tickets,
  };

  const signature = signData(hashTickets(ticketsWithNonce), lpPK);

  return { tickets, signature };
}

let testSetup: L1TestSetup;

beforeEach(async () => {
  const lpWallet = new ethers.Wallet(lpPK, ethers.provider);
  const customerWallet = new ethers.Wallet(customerPK, ethers.provider);
  const l1Deployer = new L1__factory(lpWallet);

  const tokenDeployer = new TestToken__factory(lpWallet);
  const lpL1 = await l1Deployer.deploy();

  const tokenBalance = 1_000_000;
  const gasLimit = 30_000_000;

  const l1Token = await tokenDeployer.deploy(tokenBalance);

  testSetup = {
    l1Token,
    lpL1,
    lpWallet,
    customerWallet,
    tokenBalance,
    gasLimit,
  };

  await distributeL1Tokens(testSetup);
});

const benchmarkResults: ScenarioGasUsage[] = [];
it("gas benchmarking", async () => {
  let nonce = 0;

  // The FIRST batch that is claimed on L1 incurs a write-to-zero-storage cost, which makes
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
