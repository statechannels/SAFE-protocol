import { ethers } from "hardhat";
const { expect } = require("chai");

import { Contract } from "ethers";
import { RECEIVER_PK, SENDER_PK } from "../src/constants";
import { hashTicket, signData } from "../src/utils";
import { Ticket } from "../src/types";

const receiverWallet = new ethers.Wallet(RECEIVER_PK, ethers.provider); // Bob
const senderWallet = new ethers.Wallet(SENDER_PK, ethers.provider); // Alice

const preimage = ethers.utils.hashMessage("Some secret preimage");
const escrowHash = ethers.utils.keccak256(
  ethers.utils.defaultAbiCoder.encode(["bytes32"], [preimage])
);

let l2Contract: Contract;

describe("L2 Contract", function () {
  beforeEach(async () => {
    const l2Deployer = await ethers.getContractFactory(
      "L2Contract",
      senderWallet
    ); // Bob deploys
    l2Contract = (await l2Deployer.deploy()).connect(receiverWallet); // Alice sends all further txs. She'll pay the gas in this example, and be msg.sender when it counts.
  });

  it("shouldn't allow proof of fraud with identical commitments", async () => {
    const ticket: Ticket = {
      senderNonce: 1,
      value: 5,
      receiver: receiverWallet.address,
      sender: senderWallet.address,
      escrowHash: escrowHash,
      expiry: 0,
    };

    const ticketHash = hashTicket(ticket);

    await l2Contract.lockFundsInEscrow(
      // Alice locks, and escrowHash is written to chain
      receiverWallet.address,
      escrowHash,
      0,
      0
    );

    const { r, s, v } = await signData(ticketHash, senderWallet.privateKey); // Bob signs
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
        escrowSecret
      )
    ).to.be.revertedWith("Tickets must be distinct");
  });
});
