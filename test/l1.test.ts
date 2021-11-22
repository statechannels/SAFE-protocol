import { ethers } from "hardhat";
import { Contract } from "ethers";
import { RECEIVER_PK, SENDER_PK } from "../src/constants";
import { hashTicket, signData } from "../src/utils";
import { Ticket } from "../src/types";
const receiverWallet = new ethers.Wallet(RECEIVER_PK, ethers.provider);
const senderWallet = new ethers.Wallet(SENDER_PK, ethers.provider);

const preimage = ethers.utils.hashMessage("Some secret preimage");
const escrowHash = ethers.utils.keccak256(preimage);

let l1Contract: Contract;
const ticketExpiry = 0;
const ticketBatchSize = 10;
const amountOfTickets = 100;
describe("L1 Contract", function () {
  beforeEach(async () => {
    const l1Deployer = await ethers.getContractFactory(
      "L1Contract",
      senderWallet
    );
    l1Contract = await l1Deployer.deploy();
  });

  it("can handle a single ticket being claimed", async () => {
    await l1Contract.deposit({ value: 5 });

    const ticket: Ticket = {
      nonce: 1,
      value: 5,
      receiver: receiverWallet.address,
      sender: senderWallet.address,
      escrowHash: escrowHash,
      expiry: ticketExpiry,
    };
    const ticketHash = hashTicket(ticket);

    const { r, s, v } = await signData(ticketHash, senderWallet.privateKey);

    await l1Contract.claimTicket(ticket, preimage, { r, s, v });
  });

  it(`can handle ${amountOfTickets} tickets being claimed sequentially`, async () => {
    await l1Contract.deposit({ value: 10000 });

    const tickets: Ticket[] = [];
    const ticketSignatures = [];
    for (let i = 1; i <= amountOfTickets; i++) {
      const newTicket = {
        nonce: i,
        value: 5,
        receiver: receiverWallet.address,
        sender: senderWallet.address,
        escrowHash: escrowHash,
        expiry: ticketExpiry,
      };

      const ticketHash = hashTicket(newTicket);

      const signature = await signData(ticketHash, senderWallet.privateKey);

      tickets.push(newTicket);
      ticketSignatures.push(signature);
    }
    for (let i = 0; i < tickets.length - 1; i++) {
      const { r, s, v } = ticketSignatures[i];

      await l1Contract.claimTicket(tickets[i], preimage, { r, s, v });
    }
  });

  it(`can handle a claim of ${amountOfTickets} tickets in batch sizes of ${ticketBatchSize}`, async () => {
    await l1Contract.deposit({ value: 10000 });

    const tickets: Ticket[] = [];
    const ticketSignatures = [];
    for (let i = 1; i <= amountOfTickets; i++) {
      const newTicket = {
        nonce: i,
        value: 5,
        receiver: receiverWallet.address,
        sender: senderWallet.address,
        escrowHash: escrowHash,
        expiry: ticketExpiry,
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
  });
});
