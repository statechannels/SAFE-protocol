import { ethers } from "hardhat";
import { BigNumber, Contract } from "ethers";

import {
  ALICE_PK,
  BOB_PK,
  ETH_TOKEN_ADDRESS,
  USE_ERC20,
} from "../src/constants";
import { hashTicket, signData } from "../src/utils";
import { Ticket } from "../src/types";
import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";
import { getBalances } from "./utils";
import { IERC20 } from "../src/contract-types/IERC20";
import { L1Contract } from "../src/contract-types/L1Contract";
const alice = new ethers.Wallet(ALICE_PK, ethers.provider);
const bob = new ethers.Wallet(BOB_PK, ethers.provider);

const preimage = ethers.utils.hashMessage("Some secret preimage");
const escrowHash = ethers.utils.keccak256(preimage);

const ticketExpiry = 9_999_999_999;
const ticketBatchSize = 10;
const amountOfTickets = 100;
const ticketValue = 10000;
const depositValue = ticketValue * amountOfTickets * 100;

let l1Contract: L1Contract;
let tokenContract: IERC20;
use(solidity);

describe(`L1 Contract using ${USE_ERC20 ? "ERC20 tokens" : "ETH"}`, () => {
  beforeEach(async () => {
    const l1Deployer = await ethers.getContractFactory("L1Contract", bob);
    l1Contract = await l1Deployer.deploy();
    const tokenDeployer = await ethers.getContractFactory("TestToken", bob);

    l1Contract = await l1Deployer.deploy();
    tokenContract = await tokenDeployer.deploy(depositValue);

    await tokenContract.approve(l1Contract.address, depositValue);
  });

  it("rejects an expired ticket", async () => {
    USE_ERC20
      ? await l1Contract.depositToken(tokenContract.address, depositValue)
      : await l1Contract.depositEth({ value: depositValue });

    const ticket: Ticket = {
      senderNonce: 1,
      value: 5,
      receiver: alice.address,
      sender: bob.address,
      escrowHash: escrowHash,
      expiry: 10,
      token: USE_ERC20 ? tokenContract.address : ETH_TOKEN_ADDRESS,
    };
    const ticketHash = hashTicket(ticket);

    const { r, s, v } = await signData(ticketHash, bob.privateKey);

    await expect(
      l1Contract.claimTicket(ticket, preimage, { r, s, v })
    ).to.be.revertedWith("The ticket is expired");
  });

  it(`can handle ${amountOfTickets} tickets being claimed sequentially`, async () => {
    const initialBalances = await getBalances(alice, bob, tokenContract);

    USE_ERC20
      ? await l1Contract.depositToken(tokenContract.address, depositValue)
      : await l1Contract.depositEth({ value: depositValue });

    const tickets: Ticket[] = [];
    const ticketSignatures = [];
    for (let i = 0; i < amountOfTickets; i++) {
      const newTicket = {
        senderNonce: i,
        value: ticketValue,
        receiver: alice.address,
        sender: bob.address,
        escrowHash: escrowHash,
        expiry: ticketExpiry,
        token: USE_ERC20 ? tokenContract.address : ETH_TOKEN_ADDRESS,
      };

      const ticketHash = hashTicket(newTicket);

      const signature = await signData(ticketHash, bob.privateKey);

      tickets.push(newTicket);
      ticketSignatures.push(signature);
    }
    for (let i = 0; i < tickets.length; i++) {
      const { r, s, v } = ticketSignatures[i];

      await l1Contract.claimTicket(tickets[i], preimage, { r, s, v });
    }
    const finalBalances = await getBalances(alice, bob, tokenContract);

    const expectedTotalTransferred = BigNumber.from(
      amountOfTickets * ticketValue
    );
    const actualTotalTransferred = finalBalances.alice.sub(
      initialBalances.alice
    );

    expect(expectedTotalTransferred.eq(actualTotalTransferred)).to.be.true;
  });

  it(`can handle a claim of ${amountOfTickets} tickets in batch sizes of ${ticketBatchSize}`, async () => {
    const initialBalances = await getBalances(alice, bob, tokenContract);

    USE_ERC20
      ? await l1Contract.depositToken(tokenContract.address, depositValue)
      : await l1Contract.depositEth({ value: depositValue });

    const tickets: Ticket[] = [];
    const ticketSignatures = [];
    for (let i = 0; i < amountOfTickets; i++) {
      const newTicket = {
        senderNonce: i,
        value: ticketValue,
        receiver: alice.address,
        sender: bob.address,
        escrowHash: escrowHash,
        expiry: ticketExpiry,
        token: USE_ERC20 ? tokenContract.address : ETH_TOKEN_ADDRESS,
      };

      const ticketHash = hashTicket(newTicket);
      const signature = await signData(ticketHash, bob.privateKey);

      tickets.push(newTicket);
      ticketSignatures.push(signature);
    }
    const preimages = new Array(amountOfTickets).fill(preimage);

    for (
      let i = ticketBatchSize;
      i <= tickets.length;
      i = i + ticketBatchSize
    ) {
      await l1Contract.claimTickets(
        tickets.slice(i - ticketBatchSize, i),
        preimages.slice(i - ticketBatchSize, i),
        ticketSignatures.slice(i - ticketBatchSize, i)
      );
    }

    const finalBalances = await getBalances(alice, bob, tokenContract);

    const expectedTotalTransferred = BigNumber.from(
      amountOfTickets * ticketValue
    );
    const actualTotalTransferred = finalBalances.alice.sub(
      initialBalances.alice
    );

    expect(expectedTotalTransferred.eq(actualTotalTransferred)).to.be.true;
  });
});
