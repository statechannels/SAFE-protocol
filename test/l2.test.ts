import { ethers } from "hardhat";
const { expect } = require("chai");

import { ALICE_PK, BOB_PK } from "../src/constants";
import { hashTicket, signData } from "../src/utils";
import { EscrowEntry, Ticket } from "../src/types";
import { L2Contract } from "../src/contract-types/L2Contract";
import { getBalances } from "./utils";

const ONE_DAY = 60 * 60 * 24;
const aliceWallet = new ethers.Wallet(ALICE_PK, ethers.provider);
const bobWallet = new ethers.Wallet(BOB_PK, ethers.provider);

const preimage = ethers.utils.hashMessage("Some secret preimage");
const escrowHash = ethers.utils.keccak256(
  ethers.utils.defaultAbiCoder.encode(["bytes32"], [preimage])
);

let l2Contract: L2Contract;

describe("L2 Contract", function () {
  beforeEach(async () => {
    const l2Deployer = await ethers.getContractFactory("L2Contract", bobWallet); // Bob deploys
    l2Contract = (await l2Deployer.deploy()).connect(aliceWallet); // Alice sends all further txs. She'll pay the gas in this example, and be msg.sender when it counts.
  });

  it("allows funds to be claimed after claim start", async () => {
    const initialBalances = await getBalances(aliceWallet, bobWallet);
    const currentBlock = await l2Contract.provider.getBlock(
      l2Contract.provider.getBlockNumber()
    );

    const entry: EscrowEntry = {
      value: 5,
      receiver: bobWallet.address,
      sender: aliceWallet.address,
      escrowHash: escrowHash,
      claimExpiry: currentBlock.timestamp + ONE_DAY,
      claimStart: 0,
    };
    await l2Contract.lockFundsInEscrow(entry, { value: 5 });

    await l2Contract.claimFunds(preimage, entry);
    const finalBalances = await getBalances(aliceWallet, bobWallet);
    const actualTotalTransferred = finalBalances.bob.sub(initialBalances.bob);

    expect(actualTotalTransferred).to.eq(5);
  });

  it("doesn't allow funds to be claimed after claim expiry", async () => {
    const initialBalances = await getBalances(aliceWallet, bobWallet);
    const currentBlock = await l2Contract.provider.getBlock(
      l2Contract.provider.getBlockNumber()
    );

    const entry: EscrowEntry = {
      value: 5,
      receiver: bobWallet.address,
      sender: aliceWallet.address,
      escrowHash: escrowHash,
      claimExpiry: 0,
      claimStart: 0,
    };
    await l2Contract.lockFundsInEscrow(entry, { value: 5 });

    await expect(l2Contract.claimFunds(preimage, entry)).to.be.revertedWith(
      "The escrow claim period has expired."
    );
  });

  it("shouldn't allow proof of fraud with identical commitments", async () => {
    const ticket: Ticket = {
      senderNonce: 1,
      value: 5,
      receiver: aliceWallet.address,
      sender: bobWallet.address,
      escrowHash: escrowHash,
      expiry: 0,
    };
    const entry: EscrowEntry = {
      value: 5,
      receiver: bobWallet.address,
      sender: aliceWallet.address,
      escrowHash: escrowHash,
      claimExpiry: 0,
      claimStart: 0,
    };
    const ticketHash = hashTicket(ticket);

    await l2Contract.lockFundsInEscrow(entry, { value: 5 });

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
