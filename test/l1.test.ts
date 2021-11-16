import { ethers } from "hardhat";
import { Contract } from "ethers";
import { expect, use } from "chai";

type Ticket = {
  value: number;
  nonce: number;
  receiver: string;
  sender: string;
  escrowHash: string;
};

const abiType = [
  "tuple(uint256 nonce,uint256 value,address receiver, address sender, bytes32 escrowHash)",
];
const receiverWallet = new ethers.Wallet(
  "0x91f47a1911c0fd985b34c25962f661f0de606f7ad38ba156902dff48b4d05f97",
  ethers.provider
);
const senderWallet = new ethers.Wallet(
  "0xf3d5b8ba24833578a22960b2c7a8be1ebb7907ffe0b346111b8839e981b28b0c",
  ethers.provider
);

const preimage = ethers.utils.hashMessage("Some secret preimage");
const escrowHash = ethers.utils.keccak256(preimage);

let l1Contract: Contract;

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
    };
    const ticketHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(abiType, [
        [
          ticket.value,
          ticket.nonce,
          ticket.receiver,
          ticket.sender,
          ticket.escrowHash,
        ],
      ])
    );

    const { r, s, v } = await signData(ticketHash, senderWallet.privateKey);

    await l1Contract.claimTicket(ticket, preimage, r, s, v);
  });

  it("can handle multiple ticket being claimed", async () => {
    await l1Contract.deposit({ value: 10000 });
    const amountOfTickets = 100;
    const tickets: Ticket[] = [];
    const ticketSignatures = [];
    for (let i = 1; i <= amountOfTickets; i++) {
      const newTicket = {
        nonce: i,
        value: 5,
        receiver: receiverWallet.address,
        sender: senderWallet.address,
        escrowHash: escrowHash,
      };

      const ticketHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(abiType, [
          [
            newTicket.value,
            newTicket.nonce,
            newTicket.receiver,
            newTicket.sender,
            newTicket.escrowHash,
          ],
        ])
      );
      const signature = await signData(ticketHash, senderWallet.privateKey);

      tickets.push(newTicket);
      ticketSignatures.push(signature);
    }
    for (let i = 0; i < tickets.length - 1; i++) {
      const { r, s, v } = ticketSignatures[i];

      await l1Contract.claimTicket(tickets[i], preimage, r, s, v);
    }
  });

  it("can handle a batch of tickets being claimed", async () => {
    await l1Contract.deposit({ value: 10000 });
    const ticketBatchSize = 10;
    const amountOfTickets = 100;

    const tickets: Ticket[] = [];
    const ticketSignatures = [];
    for (let i = 1; i <= amountOfTickets; i++) {
      const newTicket = {
        nonce: i,
        value: 5,
        receiver: receiverWallet.address,
        sender: senderWallet.address,
        escrowHash: escrowHash,
      };

      const ticketHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(abiType, [
          [
            newTicket.value,
            newTicket.nonce,
            newTicket.receiver,
            newTicket.sender,
            newTicket.escrowHash,
          ],
        ])
      );
      const signature = await signData(ticketHash, senderWallet.privateKey);

      tickets.push(newTicket);
      ticketSignatures.push(signature);
    }
    const preimages = new Array(amountOfTickets).fill(preimage);
    const r = ticketSignatures.map((sig) => sig.r);
    const v = ticketSignatures.map((sig) => sig.v);
    const s = ticketSignatures.map((sig) => sig.s);

    for (
      let i = ticketBatchSize;
      i <= tickets.length;
      i = i + ticketBatchSize
    ) {
      await l1Contract.claimTickets(
        tickets.slice(i - ticketBatchSize, i),
        preimages.slice(i - ticketBatchSize, i),
        r.slice(i - ticketBatchSize, i),
        s.slice(i - ticketBatchSize, i),
        v.slice(i - ticketBatchSize, i)
      );
    }
  });
});

// TODO: This was stolen from our old nitro protocol repo
// Probably a cleaner way of signing it
function signData(hashedData: string, privateKey: string): any {
  const signingKey = new ethers.utils.SigningKey(privateKey);
  const hashedMessage = ethers.utils.hashMessage(
    ethers.utils.arrayify(hashedData)
  );
  return ethers.utils.splitSignature(signingKey.signDigest(hashedMessage));
}
