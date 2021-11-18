import { Ticket } from "./types";
import { ethers } from "hardhat";
import { ABI_TYPE } from "./constants";

export function hashTicket(ticket: Ticket): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(ABI_TYPE, [
      [
        ticket.value,
        ticket.nonce,
        ticket.receiver,
        ticket.sender,
        ticket.escrowHash,
      ],
    ])
  );
}

// TODO: This was stolen from our old nitro protocol repo
// Probably a cleaner way of signing it
export function signData(hashedData: string, privateKey: string): any {
  const signingKey = new ethers.utils.SigningKey(privateKey);
  const hashedMessage = ethers.utils.hashMessage(
    ethers.utils.arrayify(hashedData)
  );
  return ethers.utils.splitSignature(signingKey.signDigest(hashedMessage));
}
