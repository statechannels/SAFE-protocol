import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

import { ethers } from "hardhat";

import { L1__factory } from "../contract-types/factories/L1__factory";
import { L2__factory } from "../contract-types/factories/L2__factory";

import { TestToken__factory } from "../contract-types/factories/TestToken__factory";

import { MAX_AUTH_DELAY } from "../src/constants";
import { TicketsWithNonce } from "../src/types";
import { hashTickets, signData } from "../src/utils";
import {
  authorizeWithdrawal,
  customer2Address,
  customerPK,
  deposit,
  distributeL1Tokens,
  distributeL2Tokens,
  lpPK,
  swap,
  TestSetup,
  ticketToL1Ticket,
  waitForTx,
} from "./utils";

const gasLimit = 30_000_000;
const tokenBalance = 1_000_000;

const customerWallet = new ethers.Wallet(customerPK, ethers.provider);
const lpWallet = new ethers.Wallet(lpPK, ethers.provider);

const l1Deployer = new L1__factory(lpWallet);
const l2Deployer = new L2__factory(lpWallet);
const tokenDeployer = new TestToken__factory(lpWallet);
let testSetup: TestSetup;

beforeEach(async () => {
  const l1Token = await tokenDeployer.deploy(tokenBalance);
  const l2Token = await tokenDeployer.deploy(tokenBalance);
  const l1 = await l1Deployer.deploy();

  const l2 = await l2Deployer.deploy();

  await l2.registerTokenPairs([
    { l1Token: l1Token.address, l2Token: l2Token.address },
  ]);
  const customerL2 = l2.connect(customerWallet);

  const lpL2 = l2.connect(lpWallet);
  const lpL1 = l1.connect(lpWallet);

  testSetup = {
    lpL1,
    lpL2,
    lpWallet,
    gasLimit,
    customerL2,
    l1Token,
    l2Token,
    customerWallet,
    tokenBalance,
  };
  await distributeL1Tokens(testSetup);
  await distributeL2Tokens(testSetup);
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
   * second ticket's l1Recipient switched to LP's address
   */
  await deposit(testSetup, 0, 10);
  await deposit(testSetup, 0, 10, customer2Address);

  const { lpL2, customerL2 } = testSetup;

  // Sign fraudulent batch
  const ticket = await lpL2.tickets(0);
  const ticket2 = await lpL2.tickets(1);

  await authorizeWithdrawal(testSetup, 0);

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
      [ticket, fraudTicket].map(ticketToL1Ticket),
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
      [ticket, fraudTicket].map(ticketToL1Ticket),
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
      [ticket3, fraudTicket2].map(ticketToL1Ticket),
      fraudSignature2,
      { gasLimit }
    )
  );
});

it("Able to get a ticket refunded", async () => {
  const { customerL2 } = testSetup;
  await deposit(testSetup, 0, 10);
  await deposit(testSetup, 0, 10, customer2Address);
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

  await deposit(testSetup, 2, 8);
  await ethers.provider.send("evm_increaseTime", [MAX_AUTH_DELAY + delta]);
  // Refund 3rd and 4th deposit
  await waitForTx(customerL2.refund(2, { gasLimit }));
});
