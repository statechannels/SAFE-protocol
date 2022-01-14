import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { ethers } from "hardhat";

import { Entry__factory } from "../contract-types/factories/Entry__factory";
import { Exit__factory } from "../contract-types/factories/Exit__factory";

import { TestToken__factory } from "../contract-types/factories/TestToken__factory";

import { MAX_AUTH_DELAY } from "../src/constants";
import { TicketsWithNonce } from "../src/types";
import { hashTickets, signData } from "../src/utils";
import {
  authorizeWithdrawal,
  customer2Address,
  customerPK,
  deposit,
  distributeEntryTokens,
  distributeExitTokens,
  lpPK,
  swap,
  TestSetup,
  ticketToEntryTicket,
  waitForTx,
} from "./utils";

const gasLimit = 30_000_000;
const tokenBalance = 1_000_000;

const customerWallet = new ethers.Wallet(customerPK, ethers.provider);
const lpWallet = new ethers.Wallet(lpPK, ethers.provider);

const entryDeployer = new Entry__factory(lpWallet);
const exitDeployer = new Exit__factory(lpWallet);
const tokenDeployer = new TestToken__factory(lpWallet);
let testSetup: TestSetup;

beforeEach(async () => {
  const entryToken = await tokenDeployer.deploy(tokenBalance);
  const exitToken = await tokenDeployer.deploy(tokenBalance);
  const entry = await entryDeployer.deploy();

  const exit = await exitDeployer.deploy();

  await exit.registerTokenPairs([
    { entryToken: entryToken.address, exitToken: exitToken.address },
  ]);
  const customerExit = exit.connect(customerWallet);

  const lpExit = exit.connect(lpWallet);
  const lpEntry = entry.connect(lpWallet);

  testSetup = {
    lpEntry,
    lpExit,
    lpWallet,
    gasLimit,
    customerExit,
    entryToken,
    exitToken,
    customerWallet,
    tokenBalance,
  };
  await distributeEntryTokens(testSetup);
  await distributeExitTokens(testSetup);
});

it("One successfull e2e swaps", async () => {
  await swap(testSetup, 0, 10);
});

it("Two successfull e2e swaps", async () => {
  await swap(testSetup, 0, 10);
  await swap(testSetup, 2, 8);
});

it("Unable to authorize overlapping batches", async () => {
  await swap(testSetup, 0, 10);
  await expect(swap(testSetup, 1, 9)).to.be.rejectedWith(
    "Batches must be gapless"
  );
});

it("Handles a fraud proofs", async () => {
  /**
   * Fraud instance 1. The liquidity provider signs a batch of tickets with the
   * second ticket's entryRecipient switched to LP's address
   */
  await deposit(testSetup, 0, 10);
  await deposit(testSetup, 0, 10, customer2Address);

  const { lpExit, customerExit } = testSetup;

  // Sign fraudulent batch
  const ticket = await lpExit.tickets(0);
  const ticket2 = await lpExit.tickets(1);

  await authorizeWithdrawal(testSetup, 0);

  const fraudTicket = { ...ticket2, entryRecipient: lpWallet.address };
  const ticketsWithNonce: TicketsWithNonce = {
    startNonce: 0,
    tickets: [ticket, fraudTicket].map(ticketToEntryTicket),
  };
  const fraudSignature = signData(hashTickets(ticketsWithNonce), lpPK);

  // Successfully prove fraud
  await waitForTx(
    customerExit.refundOnFraud(
      0,
      1,
      0,
      1,
      [ticket, fraudTicket].map(ticketToEntryTicket),
      fraudSignature,
      { gasLimit }
    )
  );

  // Unsuccessfully try to claim fraud again
  await expect(
    customerExit.refundOnFraud(
      0,
      1,
      0,
      1,
      [ticket, fraudTicket].map(ticketToEntryTicket),
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
  await deposit(testSetup, 2, 8);
  await deposit(testSetup, 0, 10, customer2Address);
  await authorizeWithdrawal(testSetup, 2);

  // Sign fraudulent batch again
  const ticket3 = await lpExit.tickets(1);
  const ticket4 = await lpExit.tickets(2);
  const fraudTicket2 = { ...ticket4, entryRecipient: lpWallet.address };
  const ticketsWithNonce2: TicketsWithNonce = {
    startNonce: 1,
    tickets: [ticket3, fraudTicket2].map(ticketToEntryTicket),
  };
  const fraudSignature2 = signData(hashTickets(ticketsWithNonce2), lpPK);

  await waitForTx(
    customerExit.refundOnFraud(
      2,
      0,
      1,
      1,
      [ticket3, fraudTicket2].map(ticketToEntryTicket),
      fraudSignature2,
      { gasLimit }
    )
  );
});

it("Able to get a ticket refunded", async () => {
  const { customerExit } = testSetup;
  await deposit(testSetup, 0, 10);
  await deposit(testSetup, 0, 10, customer2Address);
  await expect(customerExit.refund(0, { gasLimit })).to.be.rejectedWith(
    "maxAuthDelay must have passed since deposit"
  );

  const delta = 5;
  await ethers.provider.send("evm_increaseTime", [MAX_AUTH_DELAY - delta]);
  await expect(customerExit.refund(1, { gasLimit })).to.be.rejectedWith(
    "maxAuthDelay must have passed since deposit"
  );
  await ethers.provider.send("evm_increaseTime", [2 * delta]);

  await waitForTx(customerExit.refund(0, { gasLimit }));
  await waitForTx(customerExit.refund(1, { gasLimit }));
  await expect(customerExit.refund(1, { gasLimit })).to.be.rejectedWith(
    "The nonce must not be a part of a batch"
  );

  await deposit(testSetup, 2, 8);
  await ethers.provider.send("evm_increaseTime", [MAX_AUTH_DELAY + delta]);
  // Refund 3rd and 4th deposit
  await waitForTx(customerExit.refund(2, { gasLimit }));
});
