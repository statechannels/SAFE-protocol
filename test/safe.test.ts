import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { ethers as ethersTypes } from "ethers";
import { ethers } from "hardhat";

import { L1__factory } from "../contract-types/factories/L1__factory";
import { L2__factory } from "../contract-types/factories/L2__factory";
import { L1, L1TicketStruct } from "../contract-types/L1";
import { L2, L2DepositStruct, TicketStruct } from "../contract-types/L2";

import { TestToken__factory } from "../contract-types/factories/TestToken__factory";
import { TestToken } from "../contract-types/TestToken";

import {
  ETH_TOKEN_ADDRESS,
  MAX_AUTH_DELAY,
  SAFETY_DELAY,
} from "../src/constants";
import { TicketsWithNonce } from "../src/types";
import { hashTickets, signData } from "../src/utils";
import { printScenarioGasUsage, ScenarioGasUsage } from "./utils";

const gasLimit = 30_000_000;
const tokenBalance = 1_000_000;
// Address 0x2a47Cd5718D67Dc81eAfB24C99d4db159B0e7bCa
const customerPK =
  "0xe1743f0184b85ac1412311be9d6e5d333df23e22efdf615d0135ca2b9ed67938";
// Address 0x9552ceB4e6FA8c356c1A76A8Bc8b1EFA7B9fb205
const lpPK =
  "0x23ac17b9c3590a8e67a1d1231ebab87dd2d3389d2f1526f842fd1326a0990f42";

// pk = 0x91f47a1911c0fd985b34c25962f661f0de606f7ad38ba156902dff48b4d05f97
const customer2Address = "0xAAAB35381A38C4fF4967DC29470F0f2637295983";

const customerWallet = new ethers.Wallet(customerPK, ethers.provider);
const lpWallet = new ethers.Wallet(lpPK, ethers.provider);

const l1Deployer = new L1__factory(lpWallet);
const l2Deployer = new L2__factory(lpWallet);
const tokenDeployer = new TestToken__factory(lpWallet);
let lpL1: L1;
let customerL2: L2, lpL2: L2;
let testToken: TestToken;
async function waitForTx(
  txPromise: Promise<ethersTypes.providers.TransactionResponse>
) {
  return (await txPromise).wait();
}

async function deposit(
  trustedNonce: number,
  trustedAmount: number,
  useERC20 = false
) {
  const depositAmount = 1;
  const deposit: L2DepositStruct = {
    trustedNonce,
    trustedAmount,
    depositAmount,
    l1Recipient: customerWallet.address,
    token: useERC20 ? testToken.address : ETH_TOKEN_ADDRESS,
  };
  const deposit2: L2DepositStruct = {
    ...deposit,
    l1Recipient: customer2Address,
  };

  await waitForTx(customerL2.depositOnL2(deposit, { value: depositAmount }));
  await waitForTx(customerL2.depositOnL2(deposit2, { value: depositAmount }));
}

async function depositOnce(
  trustedNonce: number,
  trustedAmount: number,
  useERC20 = false
) {
  const depositAmount = 1;
  const deposit: L2DepositStruct = {
    trustedNonce,
    trustedAmount,
    depositAmount,
    l1Recipient: customerWallet.address,
    token: useERC20 ? testToken.address : ETH_TOKEN_ADDRESS,
  };

  await waitForTx(customerL2.depositOnL2(deposit, { value: depositAmount }));
}
async function authorizeWithdrawal(
  trustedNonce: number,
  numTickets = 2
): Promise<{ tickets: L1TicketStruct[]; signature: ethersTypes.Signature }> {
  const tickets: L1TicketStruct[] = [];
  for (let i = 0; i < numTickets; i++) {
    tickets.push(ticketToL1Ticket(await lpL2.tickets(trustedNonce + i)));
  }

  const ticketsWithNonce: TicketsWithNonce = {
    startNonce: trustedNonce,
    tickets,
  };
  const signature = signData(hashTickets(ticketsWithNonce), lpPK);
  await waitForTx(
    lpL2.authorizeWithdrawal(
      trustedNonce,
      trustedNonce + numTickets - 1,
      signature,
      {
        // TODO: remove this after addressing https://github.com/statechannels/SAFE-protocol/issues/70
        gasLimit,
      }
    )
  );
  return { tickets, signature };
}

/**
 *
 * @param trustedNonce The sum of all tickets starting with trustedNonce + new deposit must be <= trustedAmount
 * @param trustedAmount amount expected to be held on L1 contract
 * @param numTickets number of tickets to include in the swap's batch
 * @returns receipt of the L1 claimBatch transaction
 */
async function swap(
  trustedNonce: number,
  trustedAmount: number,
  numTickets = 2,
  useERC20 = false
) {
  for (let i = 0; i < numTickets; i++) {
    await depositOnce(trustedNonce, trustedAmount, useERC20);
  }

  const { tickets, signature } = await authorizeWithdrawal(
    trustedNonce,
    numTickets
  );

  const l1TransactionReceipt = await waitForTx(
    lpL1.claimBatch(tickets, signature, { gasLimit })
  );

  await ethers.provider.send("evm_increaseTime", [SAFETY_DELAY + 1]);
  await waitForTx(lpL2.claimL2Funds(trustedNonce));

  // TODO: This ought to estimate the total user cost. The cost of the L1 transaction
  // is currently used as a rough estimate of the total user cost.
  return l1TransactionReceipt;
}

beforeEach(async () => {
  const l1 = await l1Deployer.deploy();
  const l2 = await l2Deployer.deploy();
  testToken = await tokenDeployer.deploy(tokenBalance);
  // Transfer 1/4 to the customer account
  await testToken.transfer(customerWallet.address, tokenBalance / 4);
  // Transfer 1/4 to the l1 contract for payouts
  await testToken.transfer(l1.address, tokenBalance / 4);
  // Transfer 1/4 to the l2 contract for payouts
  await testToken.transfer(l2.address, tokenBalance / 4);
  // Approve both contracts for both parties to transfer tokens
  await testToken.approve(l2.address, tokenBalance);
  await testToken.approve(l1.address, tokenBalance);
  const customerTestToken = testToken.connect(customerWallet);
  await customerTestToken.approve(l1.address, tokenBalance);
  await customerTestToken.approve(l2.address, tokenBalance);

  customerL2 = l2.connect(customerWallet);

  lpL2 = l2.connect(lpWallet);
  lpL1 = l1.connect(lpWallet);

  await waitForTx(
    lpWallet.sendTransaction({
      to: l1.address,
      value: ethers.utils.parseUnits("1000000000", "wei"),
    })
  );
});

it("One successful e2e swap with ERC20", async () => {
  const initialBalances = await getTokenBalances();

  await swap(0, 10, 2, true);

  const finalBalances = await getTokenBalances();
  // TODO: We should probably create separate token contracts for L1 and L2
  // This would make tracking balances easier

  // Since both L1 and L2 contracts are sharing the same token contract we end up with no change
  // The customer sends 2 coins to the L2 contract and then receives 2 coins from the L1 contract
  expect(finalBalances.customer).to.eq(initialBalances.customer);

  // The LP should received 2 coins for the two swaps
  expect(finalBalances.lp).to.eq(initialBalances.lp + 2);
  // The L1 contract should have paid out 2 coins to the customer
  expect(finalBalances.l1Contract).to.eq(initialBalances.l1Contract - 2);

  // The L2 contract receives a deposit of 2 and then pays out 2 coins resulting in no change
  expect(finalBalances.l2Contract).to.eq(initialBalances.l2Contract);
});

it("One successfull e2e swaps", async () => {
  await swap(0, 10);
});

it("Two successfull e2e swaps", async () => {
  await swap(0, 10);
  await swap(2, 8);
});

it("Unable to authorize overlapping batches", async () => {
  await swap(0, 10);
  await expect(swap(1, 9)).to.be.rejectedWith("Batches must be gapless");
});

function ticketToL1Ticket(ticket: TicketStruct): L1TicketStruct {
  return {
    value: ticket.value,
    l1Recipient: ticket.l1Recipient,
    token: ticket.token,
  };
}

it("Handles a fraud proofs", async () => {
  /**
   * Fraud instance 1. The liquidity provider signs a batch of tickets with the
   * second ticket's l1Recipient switched to LP's address
   */
  await deposit(0, 10);

  // Sign fraudulent batch
  const ticket = await lpL2.tickets(0);
  const ticket2 = await lpL2.tickets(1);
  await authorizeWithdrawal(0);

  const fraudTicket = { ...ticket2, l1Recipient: lpWallet.address };
  const ticketsWithNonce: TicketsWithNonce = {
    startNonce: 0,
    tickets: [ticket, fraudTicket].map(ticketToL1Ticket),
  };
  const fraudSignature = signData(hashTickets(ticketsWithNonce), lpPK);

  // Successfully prove fraud
  await waitForTx(
    customerL2.refundOnFraud(
      0,
      1,
      0,
      1,
      [ticket, fraudTicket],
      fraudSignature,
      { gasLimit }
    )
  );

  // Unsuccessfully try to claim fraud again
  await expect(
    customerL2.refundOnFraud(
      0,
      1,
      0,
      1,
      [ticket, fraudTicket],
      fraudSignature,
      {
        gasLimit,
      }
    )
  ).to.be.rejectedWith("Batch status must be Authorized");

  /**
   * Fraud instance 2. The setup is:
   * - There are 4 tickets. The first two tickets have been refunded above.
   * - The second two tickets are authorized by LP.
   * - LP signs a batch that includes a correct 2nd ticket and a fraudulent 3rd ticket.
   */
  await deposit(2, 8);
  await authorizeWithdrawal(2);

  // Sign fraudulent batch again
  const ticket3 = await lpL2.tickets(1);
  const ticket4 = await lpL2.tickets(2);
  const fraudTicket2 = { ...ticket4, l1Recipient: lpWallet.address };
  const ticketsWithNonce2: TicketsWithNonce = {
    startNonce: 1,
    tickets: [ticket3, fraudTicket2].map(ticketToL1Ticket),
  };
  const fraudSignature2 = signData(hashTickets(ticketsWithNonce2), lpPK);

  await waitForTx(
    customerL2.refundOnFraud(
      2,
      0,
      1,
      1,
      [ticket3, fraudTicket2],
      fraudSignature2,
      { gasLimit }
    )
  );
});

it("Able to get a ticket refunded", async () => {
  await deposit(0, 10);
  await expect(customerL2.refund(0, { gasLimit })).to.be.rejectedWith(
    "maxAuthDelay must have passed since deposit"
  );

  const delta = 5;
  await ethers.provider.send("evm_increaseTime", [MAX_AUTH_DELAY - delta]);
  await expect(customerL2.refund(1, { gasLimit })).to.be.rejectedWith(
    "maxAuthDelay must have passed since deposit"
  );
  await ethers.provider.send("evm_increaseTime", [2 * delta]);

  await waitForTx(customerL2.refund(0, { gasLimit }));
  await waitForTx(customerL2.refund(1, { gasLimit }));
  await expect(customerL2.refund(1, { gasLimit })).to.be.rejectedWith(
    "The nonce must not be a part of a batch"
  );

  await deposit(2, 8);
  await ethers.provider.send("evm_increaseTime", [MAX_AUTH_DELAY + delta]);
  // Refund 3rd and 4th deposit
  await waitForTx(customerL2.refund(2, { gasLimit }));
});

async function benchmark(
  scenarios: number[],
  nonce: number,
  useERC20 = false
): Promise<{ nonce: number; results: ScenarioGasUsage[] }> {
  const results: ScenarioGasUsage[] = [];
  for (const batchSize of scenarios) {
    const { gasUsed } = await swap(nonce, 100_000, batchSize, useERC20);
    results.push({ totalGasUsed: gasUsed, batchSize });
    nonce += batchSize;
  }

  return { nonce, results };
}

let ethResults: ScenarioGasUsage[];
let erc20Results: ScenarioGasUsage[];
it("gas benchmarking", async () => {
  let nonce = 0;

  // The FIRST batch that is claimed on L1 incurs a write-to-zero-storage cost, which makes
  // for a counter-intuitive list of results. So, we trigger an initial swap before
  // starting the benchmark
  await swap(0, 100_000, 1);
  nonce++;

  const benchmarkScenarios = [
    1,
    2,
    5,
    20,
    50,
    62, // THE GAS COST IS ... UNDER 9000!!!
  ];

  const ethRun = await benchmark(benchmarkScenarios, nonce, true);
  ethResults = ethRun.results;
  const erc20run = await benchmark(benchmarkScenarios, ethRun.nonce, false);
  erc20Results = erc20run.results;
}).timeout(60_000); // TODO: We should probably split gas benchmarking into it's own test command so unit tests can run faster

// Currently using numbers for convenience, as the amount of tokens is pretty small
type TokenBalances = {
  lp: number;
  customer: number;
  l1Contract: number;
  l2Contract: number;
};
async function getTokenBalances(): Promise<TokenBalances> {
  return {
    lp: (await testToken.balanceOf(lpWallet.address)).toNumber(),
    customer: (await testToken.balanceOf(customerWallet.address)).toNumber(),
    l1Contract: (await testToken.balanceOf(lpL1.address)).toNumber(),
    l2Contract: (await testToken.balanceOf(lpL2.address)).toNumber(),
  };
}

after(() => {
  printScenarioGasUsage(ethResults, `L1 claimBatch (ETH) Gas Usage`);

  printScenarioGasUsage(erc20Results, `L1 claimBatch (ERC20) Gas Usage`);
});
