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
  createCustomer,
  customerPK,
  distributeEntryChainTokens,
  EntryChainTestSetup,
  getOptimismL1Fee,
  lpPK,
  printScenarioGasUsage,
  ScenarioGasUsage,
  waitForTx,
} from "./utils";
import { TokenPairStruct } from "../contract-types/ExitChainEscrow";
import { TestToken } from "../contract-types/TestToken";

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

  const claimTransaction = await lpEntryChain.claimBatch(tickets, signature);
  const { gasUsed } = await waitForTx(claimTransaction);
  return {
    totalGasUsed: gasUsed,
    batchSize,
    optimismCost: getOptimismL1Fee(claimTransaction),
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
  let customer = await createCustomer(
    testSetup.lpWallet,
    testSetup.lpEntryChain.address,
    tokens
  );
  for (let i = 0; i < numTickets; i++) {
    if (customerMode === "Unique") {
      customer = await createCustomer(
        testSetup.lpWallet,
        testSetup.lpEntryChain.address,
        tokens
      );
    }
    // Pick a random token from the list of supported tokens
    const randomToken = tokens[Math.floor(Math.random() * tokens.length)];

    tickets.push({
      entryChainRecipient: customer.address,
      value: amountOfTokens,
      token: randomToken.contract.address,
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

const tokens: Array<{ pair: TokenPairStruct; contract: TestToken }> = [];
beforeEach(async () => {
  const lpWallet = new ethers.Wallet(lpPK, ethers.provider);
  const customerWallet = new ethers.Wallet(customerPK, ethers.provider);
  const entryChainDeployer = new EntryChainEscrow__factory(lpWallet);

  const tokenDeployer = new TestToken__factory(lpWallet);
  const lpEntryChain = await entryChainDeployer.deploy();

  const tokenBalance = 1_000_000;
  const gasLimit = 30_000_000;
  const amountOfTokenContracts = 5;

  const entryChainToken = await tokenDeployer.deploy(tokenBalance);

  for (let i = 0; i < amountOfTokenContracts; i++) {
    // Deploy a new token
    const contract = await tokenDeployer.deploy(tokenBalance);
    // Use a random address for it's pair since it represents an address on a different chain
    const randomAddress = Wallet.createRandom().address;
    const pair = {
      entryChainToken: contract.address,
      exitChainToken: randomAddress,
    };
    tokens.push({ pair, contract });
    // Send 1/4 of the token balance to the contract for payouts
    await contract.transfer(lpEntryChain.address, tokenBalance / 4);
  }

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
it("entry gas benchmarking", async () => {
  let nonce = 0;

  // The FIRST batch that is claimed on EntryChain incurs a write-to-zero-storage cost, which makes
  // for a counter-intuitive list of results. So, we trigger an initial swap before
  // starting the benchmark
  await runScenario(nonce, 1, "Unique");
  nonce++;

  const benchmarkScenarios = [1, 5, 20];

  for (const batchSize of benchmarkScenarios) {
    benchmarkResults.push(await runScenario(nonce, batchSize, "Unique"));

    nonce += batchSize;
  }
}).timeout(60_000);

after(() => printScenarioGasUsage(benchmarkResults));
