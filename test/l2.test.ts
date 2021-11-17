import { ethers } from "hardhat";
const { expect } = require("chai");

import { Contract } from "ethers";

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
const receiverWallet = new ethers.Wallet( // Bob
  "0x91f47a1911c0fd985b34c25962f661f0de606f7ad38ba156902dff48b4d05f97",
  ethers.provider
);
const senderWallet = new ethers.Wallet( // Alice
  "0xf3d5b8ba24833578a22960b2c7a8be1ebb7907ffe0b346111b8839e981b28b0c",
  ethers.provider
);

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

// TODO: This was stolen from our old nitro protocol repo
// Probably a cleaner way of signing it
function signData(hashedData: string, privateKey: string): any {
  const signingKey = new ethers.utils.SigningKey(privateKey);
  const hashedMessage = ethers.utils.hashMessage(
    ethers.utils.arrayify(hashedData)
  );
  return ethers.utils.splitSignature(signingKey.signDigest(hashedMessage));
}
