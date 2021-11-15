import { ethers } from "hardhat";

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

describe("L1 Contract", function () {
  it("can handle a  single ticket being claimed", async () => {
    const receiverWallet = new ethers.Wallet(
      "0x91f47a1911c0fd985b34c25962f661f0de606f7ad38ba156902dff48b4d05f97",
      ethers.provider
    );
    const senderWallet = new ethers.Wallet(
      "0xf3d5b8ba24833578a22960b2c7a8be1ebb7907ffe0b346111b8839e981b28b0c",
      ethers.provider
    );
    const l1Deployer = await ethers.getContractFactory(
      "L1Contract",
      senderWallet
    );
    const l1Contract = await l1Deployer.deploy();

    const preimage = ethers.utils.hashMessage("Some secret preimage");
    const escrowHash = ethers.utils.keccak256(preimage);

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
