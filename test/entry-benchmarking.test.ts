import chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { ethers as ethersTypes, Wallet } from "ethers";
import { ethers } from "hardhat";

import { ToChainEscrow__factory } from "../contract-types/factories/ToChainEscrow__factory";
import { TestToken__factory } from "../contract-types/factories/TestToken__factory";
import { ToChainTicketStruct } from "../contract-types/ToChainEscrow";
import { TicketsWithNonce } from "../src/types";
import { hashTickets, signData } from "../src/utils";
import {
  createCustomer,
  customerPK,
  distributeToChainTokens,
  ToChainTestSetup,
  lpPK,
  printScenarioGasUsage,
  ScenarioGasUsage,
  waitForTx,
} from "./utils";
import { TokenPairStruct } from "../contract-types/FromChainEscrow";
import { TestToken } from "../contract-types/TestToken";
import { getOptimismL1Fee } from "./gas-utils";

async function runScenario(
  nonce: number,
  batchSize: number,
  customerMode: "Unique" | "Same"
): Promise<ScenarioGasUsage> {
  const { lpToChain } = testSetup;
  const { tickets, signature } = await generateTickets(
    nonce,
    batchSize,
    customerMode
  );

  const claimTransaction = await lpToChain.claimBatch(tickets, signature);
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
  tickets: ToChainTicketStruct[];
  signature: ethersTypes.Signature;
}> {
  const tickets: ToChainTicketStruct[] = [];
  let customer = await createCustomer(
    testSetup.lpWallet,
    testSetup.lpToChain.address,
    tokens
  );
  for (let i = 0; i < numTickets; i++) {
    if (customerMode === "Unique") {
      customer = await createCustomer(
        testSetup.lpWallet,
        testSetup.lpToChain.address,
        tokens
      );
    }
    // Pick a random token from the list of supported tokens
    const randomToken = tokens[Math.floor(Math.random() * tokens.length)];

    tickets.push({
      toChainRecipient: customer.address,
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

let testSetup: ToChainTestSetup;
const tokens: Array<{ pair: TokenPairStruct; contract: TestToken }> = [];
describe("to benchmarking", () => {
  beforeEach(async () => {
    const lpWallet = new ethers.Wallet(lpPK, ethers.provider);
    const customerWallet = new ethers.Wallet(customerPK, ethers.provider);
    const toChainDeployer = new ToChainEscrow__factory(lpWallet);

    const tokenDeployer = new TestToken__factory(lpWallet);
    const lpToChain = await toChainDeployer.deploy();

    const tokenBalance = 1_000_000;
    const gasLimit = 30_000_000;
    const amountOfTokenContracts = 5;

    const toChainToken = await tokenDeployer.deploy(tokenBalance);

    for (let i = 0; i < amountOfTokenContracts; i++) {
      // Deploy a new token
      const contract = await tokenDeployer.deploy(tokenBalance);
      // Use a random address for it's pair since it represents an address on a different chain
      const randomAddress = Wallet.createRandom().address;
      const pair = {
        toChainToken: contract.address,
        fromChainToken: randomAddress,
      };
      tokens.push({ pair, contract });
      // Send 1/4 of the token balance to the contract for payouts
      await contract.transfer(lpToChain.address, tokenBalance / 4);
    }

    testSetup = {
      toChainToken,
      lpToChain,
      lpWallet,
      customerWallet,
      tokenBalance,
      gasLimit,
    };
    await distributeToChainTokens(testSetup);
  });

  const benchmarkResults: ScenarioGasUsage[] = [];

  it("to gas benchmarking", async () => {
    let nonce = 0;

    // The FIRST batch that is claimed on ToChain incurs a write-to-zero-storage cost, which makes
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
});
