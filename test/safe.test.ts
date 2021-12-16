import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { ethers as ethersTypes } from "ethers";
import { ethers } from "hardhat";

import { L1__factory } from "../contract-types/factories/L1__factory";
import { L2__factory } from "../contract-types/factories/L2__factory";
import { L1, TicketStruct } from "../contract-types/L1";
import { L2, L2DepositStruct } from "../contract-types/L2";
import { TicketsWithNonce } from "../src/types";
import { hashTickets, signData } from "../src/utils";
import { printScenarioGasUsage, ScenarioGasUsage } from "./utils";

const gasLimit = 30_000_000;

// Address 0x2a47Cd5718D67Dc81eAfB24C99d4db159B0e7bCa
const customerPK =
  "0xe1743f0184b85ac1412311be9d6e5d333df23e22efdf615d0135ca2b9ed67938";
// Address 0x9552ceB4e6FA8c356c1A76A8Bc8b1EFA7B9fb205
const lpPK =
  "0x23ac17b9c3590a8e67a1d1231ebab87dd2d3389d2f1526f842fd1326a0990f42";

// pk = 0x91f47a1911c0fd985b34c25962f661f0de606f7ad38ba156902dff48b4d05f97
const customer2Address = "0xAAAB35381A38C4fF4967DC29470F0f2637295983"

const customerWallet = new ethers.Wallet(customerPK, ethers.provider);
const lpWallet = new ethers.Wallet(lpPK, ethers.provider);

const l1Deployer = new L1__factory(lpWallet);
const l2Deployer = new L2__factory(lpWallet);

let lpL1: L1;
let customerL2: L2, lpL2: L2;

async function waitForTx(
  txPromise: Promise<ethersTypes.providers.TransactionResponse>,
) {
  return (await txPromise).wait();
}

async function deposit(trustedNonce: number, trustedAmount: number) {
  const depositAmount = 1;
  const deposit: L2DepositStruct = {
    trustedNonce,
    trustedAmount,
    depositAmount,
    l1Recipient: customerWallet.address,
  };
  const deposit2: L2DepositStruct = {
    ...deposit,
    l1Recipient: customer2Address,
  };

  await waitForTx(customerL2.depositOnL2(deposit, { value: depositAmount }));
  await waitForTx(customerL2.depositOnL2(deposit2, { value: depositAmount }));
}

async function depositOnce(trustedNonce: number, trustedAmount: number) {
  const depositAmount = 1;
  const deposit: L2DepositStruct = {
    trustedNonce,
    trustedAmount,
    depositAmount,
    l1Recipient: customerWallet.address,
  };

  await waitForTx(customerL2.depositOnL2(deposit, { value: depositAmount }));
}

async function authorizeWithdrawal(
  trustedNonce: number,
  numTickets = 2
): Promise<{ tickets: TicketStruct[], signature: ethersTypes.Signature }> {
  let tickets: TicketStruct[] = []
  for (let i = 0; i < numTickets; i++) {
    tickets.push(await lpL2.tickets(trustedNonce + i))
  }

  const ticketsWithNonce: TicketsWithNonce = { startNonce: trustedNonce, tickets };
  const signature = signData(hashTickets(ticketsWithNonce), lpPK);
  await waitForTx(
    lpL2.authorizeWithdrawal(trustedNonce, trustedNonce + numTickets - 1, signature, {
      // TODO: remove this after addressing https://github.com/statechannels/SAFE-protocol/issues/70
      gasLimit,
    }),
  );
  return { tickets, signature };
}

/**
 * 
 * @param trustedNonce ???
 * @param trustedAmount amount expected to be held on L1 contract
 * @param numTickets number of tickets to include in the swap's batch
 * @returns receipt of the L1 claimBatch transaction
 */
async function swap(trustedNonce: number, trustedAmount: number, numTickets = 2) {
  for (let i = 0; i < numTickets; i++) {
    await depositOnce(trustedNonce, trustedAmount);
  }
  const { tickets, signature } = await authorizeWithdrawal(trustedNonce, numTickets);

  const l1TransactionReceipt = await waitForTx(lpL1.claimBatch(tickets, signature, { gasLimit }));

  await ethers.provider.send("evm_increaseTime", [121]);
  await waitForTx(lpL2.claimL2Funds(trustedNonce));

  // TODO: This ought to estimate the total user cost. The cost of the L1 transaction
  // is currently used as a rough estimate of the total user cost.
  return l1TransactionReceipt
}

beforeEach(async () => {
  const l1 = await l1Deployer.deploy();
  const l2 = await l2Deployer.deploy();

  customerL2 = l2.connect(customerWallet);

  lpL2 = l2.connect(lpWallet);
  lpL1 = l1.connect(lpWallet);

  await waitForTx(
    lpWallet.sendTransaction({
      to: l1.address,
      value: ethers.utils.parseUnits("1000000000", "wei"),
    }),
  );
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
    tickets: [ticket, fraudTicket],
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
    ),
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
      },
    ),
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
    tickets: [ticket3, fraudTicket2],
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
      { gasLimit },
    ),
  );
});

it("Able to get a ticket refunded", async () => {
  await deposit(0, 10);
  await expect(customerL2.refund(0, { gasLimit })).to.be.rejectedWith(
    "maxAuthDelay must have passed since deposit",
  );
  await ethers.provider.send("evm_increaseTime", [61]);
  await waitForTx(customerL2.refund(0, { gasLimit }));
  await waitForTx(customerL2.refund(1, { gasLimit }));
  await expect(customerL2.refund(1, { gasLimit })).to.be.rejectedWith(
    "The nonce must not be a part of a batch",
  );

  await deposit(2, 8);
  await ethers.provider.send("evm_increaseTime", [61]);
  // Refund 3rd and 4th deposit
  await waitForTx(customerL2.refund(2, { gasLimit }));
});

const benchmarkResults: ScenarioGasUsage[] = []
it("gas benchmarking", async () => {
  const benchmarkScenarios = [
    1,
    2,
    5,
    20,
    50,
    // TODO: When I run the following case, I get:
    //      Error: VM Exception while processing transaction: reverted with reason string 'Must be within autorization window'
    // 100,
  ];

  let nonce = 0
  for (const batchSize of benchmarkScenarios) {
    const { gasUsed } = await swap(nonce, 100_000, batchSize)
    benchmarkResults.push({ totalGasUsed: gasUsed, batchSize })
    nonce += batchSize
  }

});

after(() => printScenarioGasUsage(benchmarkResults))
