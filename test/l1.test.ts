import { ethers } from "hardhat";
import { BigNumber, Contract, Wallet } from "ethers";
import {
  ETH_TOKEN_ADDRESS,
  RECEIVER_PK,
  SENDER_PK,
  USE_ERC20,
} from "../src/constants";
import { hashTicket, signData } from "../src/utils";
import { Ticket } from "../src/types";
import { expect } from "chai";
import { L1Contract } from "../src/contract-types/L1Contract";
import { TestToken } from "../src/contract-types/TestToken";
const receiverWallet = new ethers.Wallet(RECEIVER_PK, ethers.provider);
const senderWallet = new ethers.Wallet(SENDER_PK, ethers.provider);

const preimage = ethers.utils.hashMessage("Some secret preimage");
const escrowHash = ethers.utils.keccak256(preimage);

const ticketBatchSize = 10;
const amountOfTickets = 100;
const ticketValue = 10000;
const depositValue = ticketValue * amountOfTickets * 100;

type Balances = { sender: BigNumber; receiver: BigNumber };

async function getBalances(): Promise<Balances> {
  const receiverWallet = new Wallet(RECEIVER_PK, ethers.provider);
  const senderWallet = new Wallet(SENDER_PK, ethers.provider);
  if (!USE_ERC20) {
    const receiver = await receiverWallet.getBalance();
    const sender = await senderWallet.getBalance();
    return { sender, receiver };
  } else {
    const receiver = await tokenContract.balanceOf(receiverWallet.address);
    const sender = await tokenContract.balanceOf(senderWallet.address);
    return { sender, receiver };
  }
}
let l1Contract: L1Contract;
let tokenContract: TestToken;

describe(`L1 Contract using ${USE_ERC20 ? "ERC20 tokens" : "ETH"}`, () => {
  beforeEach(async () => {
    const l1Deployer = await ethers.getContractFactory(
      "L1Contract",
      senderWallet
    );
    l1Contract = await l1Deployer.deploy();
    const tokenDeployer = await ethers.getContractFactory(
      "TestToken",
      senderWallet
    );

    l1Contract = await l1Deployer.deploy();
    tokenContract = await tokenDeployer.deploy(1_000_000_000);
    await tokenContract.approve(l1Contract.address, 1_000_000_000);
  });

  it(`can handle ${amountOfTickets} tickets being claimed sequentially`, async () => {
    const initialBalances = await getBalances();

    USE_ERC20
      ? await l1Contract.depositToken(tokenContract.address, depositValue)
      : await l1Contract.depositEth({ value: depositValue });

    const tickets: Ticket[] = [];
    const ticketSignatures = [];
    for (let i = 1; i <= amountOfTickets; i++) {
      const newTicket = {
        nonce: i,
        value: ticketValue,
        receiver: receiverWallet.address,
        sender: senderWallet.address,
        escrowHash: escrowHash,
        token: USE_ERC20 ? tokenContract.address : ETH_TOKEN_ADDRESS,
      };

      const ticketHash = hashTicket(newTicket);

      const signature = await signData(ticketHash, senderWallet.privateKey);

      tickets.push(newTicket);
      ticketSignatures.push(signature);
    }
    for (let i = 0; i < tickets.length; i++) {
      const { r, s, v } = ticketSignatures[i];

      await l1Contract.claimTicket(tickets[i], preimage, { r, s, v });
    }
    const finalBalances = await getBalances();

    const expectedTotalTransferred = BigNumber.from(
      amountOfTickets * ticketValue
    );
    const actualTotalTransferred = finalBalances.receiver.sub(
      initialBalances.receiver
    );

    expect(expectedTotalTransferred.eq(actualTotalTransferred)).to.be.true;
  });

  it(`can handle a claim of ${amountOfTickets} tickets in batch sizes of ${ticketBatchSize}`, async () => {
    const initialBalances = await getBalances();

    USE_ERC20
      ? await l1Contract.depositToken(tokenContract.address, depositValue)
      : await l1Contract.depositEth({ value: depositValue });

    const tickets: Ticket[] = [];
    const ticketSignatures = [];
    for (let i = 1; i <= amountOfTickets; i++) {
      const newTicket = {
        nonce: i,
        value: ticketValue,
        receiver: receiverWallet.address,
        sender: senderWallet.address,
        escrowHash: escrowHash,
        token: USE_ERC20 ? tokenContract.address : ETH_TOKEN_ADDRESS,
      };

      const ticketHash = hashTicket(newTicket);
      const signature = await signData(ticketHash, senderWallet.privateKey);

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

    const finalBalances = await getBalances();

    const expectedTotalTransferred = BigNumber.from(
      amountOfTickets * ticketValue
    );
    const actualTotalTransferred = finalBalances.receiver.sub(
      initialBalances.receiver
    );

    expect(expectedTotalTransferred.eq(actualTotalTransferred)).to.be.true;
  });
});
