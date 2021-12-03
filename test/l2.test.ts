import { ethers } from "hardhat";
const { expect } = require("chai");

import { ALICE_PK, BOB_PK } from "../src/constants";
import { hashTicket, signData } from "../src/utils";
import { EscrowEntry, Ticket } from "../src/types";
import { L2Contract } from "../contract-types/L2Contract";
import { L2Contract__factory } from "../contract-types/factories/L2Contract__factory";
import { getBalances } from "./utils";

const ONE_DAY = 60 * 60 * 24;
const aliceWallet = new ethers.Wallet(ALICE_PK, ethers.provider);
const bobWallet = new ethers.Wallet(BOB_PK, ethers.provider);
const ticketExpiry = 9_999_999_999;
const transferAmount = ethers.utils.parseUnits("1", "finney").toNumber();
const preimage = ethers.utils.hashMessage("Some secret preimage");
const escrowHash = ethers.utils.keccak256(
  ethers.utils.defaultAbiCoder.encode(["bytes32"], [preimage])
);

let l2Contract: L2Contract;

describe("L2 Contract", function () {
  beforeEach(async () => {
    const l2Deployer = new L2Contract__factory(bobWallet);
    l2Contract = (await l2Deployer.deploy()).connect(aliceWallet); // Alice sends all further txs. She'll pay the gas in this example, and be msg.sender when it counts.
  });

  it("allows funds to be refunded after claim expiry", async () => {
    const entry: EscrowEntry = {
      value: transferAmount,
      receiver: bobWallet.address,
      sender: aliceWallet.address,
      escrowHash: escrowHash,
      claimExpiry: 1,
      claimStart: 0,
    };
    await l2Contract.lockFundsInEscrow(entry, { value: transferAmount });
    const afterEscrow = await getBalances(aliceWallet, bobWallet);
    console.log(afterEscrow);
    await l2Contract.refund(entry);
    const finalBalances = await getBalances(aliceWallet, bobWallet);

    // TODO: Due to gas fees, it's hard to check that Alice got back transferAmount.
    expect(finalBalances.alice.gt(afterEscrow.alice)).to.be.true;
  });

  it("allows funds to be claimed after claim start", async () => {
    const initialBalances = await getBalances(aliceWallet, bobWallet);
    const currentBlock = await l2Contract.provider.getBlock(
      l2Contract.provider.getBlockNumber()
    );

    const entry: EscrowEntry = {
      value: transferAmount,
      receiver: bobWallet.address,
      sender: aliceWallet.address,
      escrowHash: escrowHash,
      claimExpiry: currentBlock.timestamp + ONE_DAY,
      claimStart: 0,
    };
    await l2Contract.lockFundsInEscrow(entry, { value: transferAmount });

    await l2Contract.claimFunds(preimage, entry);
    const finalBalances = await getBalances(aliceWallet, bobWallet);
    const actualTotalTransferred = finalBalances.bob.sub(initialBalances.bob);

    expect(actualTotalTransferred).to.eq(transferAmount);
  });

  it("doesn't allow funds to be claimed after claim expiry", async () => {
    const entry: EscrowEntry = {
      value: transferAmount,
      receiver: bobWallet.address,
      sender: aliceWallet.address,
      escrowHash: escrowHash,
      claimExpiry: 0,
      claimStart: 0,
    };
    await l2Contract.lockFundsInEscrow(entry, { value: transferAmount });

    await expect(l2Contract.claimFunds(preimage, entry)).to.be.revertedWith(
      "The escrow claim period has expired."
    );
  });

  it("allows for fraud to be proven", async () => {
    const legitTicket: Ticket = {
      senderNonce: 1,
      value: transferAmount,
      receiver: aliceWallet.address,
      sender: bobWallet.address,
      escrowHash: escrowHash,
      expiry: ticketExpiry,
    };
    const fraudTicket: Ticket = {
      ...legitTicket,
      escrowHash: ethers.utils.hashMessage("FRAUD"),
    };
    const entry: EscrowEntry = {
      value: transferAmount,
      receiver: bobWallet.address,
      sender: aliceWallet.address,
      escrowHash: escrowHash,
      claimExpiry: 0,
      claimStart: 0,
    };
    const legitTicketHash = hashTicket(legitTicket);
    const fraudTicketHash = hashTicket(fraudTicket);

    const legitSignature = await signData(
      legitTicketHash,
      bobWallet.privateKey
    );
    const fraudSignature = await signData(
      fraudTicketHash,
      bobWallet.privateKey
    );

    const initialBalance = await getBalances(aliceWallet, bobWallet);

    await l2Contract
      .connect(aliceWallet)
      .lockFundsInEscrow(entry, { value: transferAmount });

    const afterEscrowBalance = await getBalances(aliceWallet, bobWallet);

    await l2Contract
      .connect(bobWallet)
      .commitToWithdrawal(legitTicket, legitSignature);

    await l2Contract
      .connect(aliceWallet)
      .proveFraud(
        legitTicket,
        legitSignature,
        fraudTicket,
        fraudSignature,
        entry,
        preimage
      );

    const afterProveFraudBalance = await getBalances(aliceWallet, bobWallet);

    expect(
      initialBalance.alice.sub(afterEscrowBalance.alice).gt(transferAmount)
    ).to.be.true;

    // TODO: Due to gas fees, it's hard to check that Alice got back transferAmount.
    expect(afterProveFraudBalance.alice.gt(afterEscrowBalance.alice)).to.be
      .true;
  });
  it("shouldn't allow proof of fraud with identical commitments", async () => {
    const ticket: Ticket = {
      senderNonce: 1,
      value: transferAmount,
      receiver: aliceWallet.address,
      sender: bobWallet.address,
      escrowHash: escrowHash,
      expiry: 0,
    };
    const entry: EscrowEntry = {
      value: transferAmount,
      receiver: bobWallet.address,
      sender: aliceWallet.address,
      escrowHash: escrowHash,
      claimExpiry: 0,
      claimStart: 0,
    };
    const ticketHash = hashTicket(ticket);

    await l2Contract.lockFundsInEscrow(entry, { value: transferAmount });

    const { r, s, v } = await signData(ticketHash, bobWallet.privateKey); // Bob signs
    const ticketSignature = { r, s, v };

    await l2Contract.commitToWithdrawal(ticket, ticketSignature); // Bob's commitment written to chain

    const commitedTicket = ticket;
    const secondTicket = ticket;
    const firstSignature = ticketSignature;
    const secondSignature = ticketSignature;
    const escrowSecret = preimage;

    await expect(
      l2Contract.proveFraud(
        // Alice tries to prove Bob's fraud
        commitedTicket,
        firstSignature,
        secondTicket,
        secondSignature,
        entry,
        escrowSecret
      )
    ).to.be.revertedWith("Tickets must be distinct");
  });
});
