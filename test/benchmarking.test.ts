import chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { ethers as ethersTypes, Wallet } from "ethers";
import { ethers } from "hardhat";

import { L1__factory } from "../contract-types/factories/L1__factory";
import { TestToken__factory } from "../contract-types/factories/TestToken__factory";
import { TestToken } from "../contract-types/TestToken";
import { L1, L1TicketStruct, TokenPairStruct } from "../contract-types/L1";
import { TicketsWithNonce } from "../src/types";
import { hashTickets, signData } from "../src/utils";
import {
  lpPK,
  printScenarioGasUsage,
  ScenarioGasUsage,
  waitForTx,
} from "./utils";

async function createCustomer(testToken: TestToken): Promise<string> {
  const { address } = Wallet.createRandom({}).connect(ethers.provider);
  // We assume the customer currently holds, or has previously held, some of the ERC20 tokens on L1.
  // To simulate this we transfer a small amount of tokens to the customer's address, triggering the initial storage write.
  // This prevents the gas cost of claimBatch including a write to zero storage cost for the first time the customer receives tokens.
  await testToken.transfer(address, 1);

  return address;
}
async function runScenario(
  nonce: number,
  batchSize: number,
  customerMode: "Unique" | "Same"
): Promise<ScenarioGasUsage> {
  const { tickets, signature } = await generateTickets(
    nonce,
    batchSize,
    customerMode
  );

  const { gasUsed } = await waitForTx(
    l1Contract.claimBatch(tickets, signature)
  );

  return { totalGasUsed: gasUsed, batchSize };
}

async function generateTickets(
  startNonce = 0,
  numTickets = 2,
  customerMode: "Unique" | "Same" = "Unique",
  amountOfTokens = 1
): Promise<{ tickets: L1TicketStruct[]; signature: ethersTypes.Signature }> {
  const tickets: L1TicketStruct[] = [];

  let customer = ethers.Wallet.createRandom().address;
  for (let i = 0; i < numTickets; i++) {
    const tokenPair = tokenPairs[Math.floor(Math.random() * tokenPairs.length)];

    if (customerMode === "Unique") {
      customer = ethers.Wallet.createRandom().address;
      await tokenPair.testToken.transfer(customer, 1);
    }

    tickets.push({
      l1Recipient: customer,
      value: amountOfTokens,
      token: tokenPair.l2Token,
    });
  }
  const ticketsWithNonce: TicketsWithNonce = {
    startNonce,
    tickets,
  };

  const signature = signData(hashTickets(ticketsWithNonce), lpPK);

  return { tickets, signature };
}
const numberOfTokenContracts = 5;
type TokenPair = TokenPairStruct & { testToken: TestToken };
let l1Contract: L1;
const tokenPairs: Array<TokenPair> = [];
beforeEach(async () => {
  const lpWallet = new ethers.Wallet(lpPK, ethers.provider);

  const l1Deployer = new L1__factory(lpWallet);

  const tokenDeployer = new TestToken__factory(lpWallet);
  l1Contract = await l1Deployer.deploy();

  const tokenBalance = 1_000_000;

  for (let i = 0; i < numberOfTokenContracts; i++) {
    const testToken = await tokenDeployer.deploy(tokenBalance);

    const l2Token = ethers.Wallet.createRandom().address;

    await testToken.transfer(l1Contract.address, tokenBalance / 4);

    tokenPairs.push({ l1Token: testToken.address, l2Token, testToken });
  }

  await l1Contract.registerTokenPairs(
    tokenPairs.map(({ l1Token, l2Token }) => ({
      l2Token,
      l1Token,
    }))
  );
});

const benchmarkResults: ScenarioGasUsage[] = [];
it.only("gas benchmarking", async () => {
  let nonce = 0;

  // The FIRST batch that is claimed on L1 incurs a write-to-zero-storage cost, which makes
  // for a counter-intuitive list of results. So, we trigger an initial swap before
  // starting the benchmark
  await runScenario(nonce, 1, "Unique");
  nonce++;
  console.log(`With ${numberOfTokenContracts} ERC Tokens`);
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
