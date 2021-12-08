import { EscrowEntry, SignedSwaps, Ticket } from "./types";
import { ethers } from "ethers";
import {
  ESCROW_ABI_TYPE,
  SIGNED_SWAPS_ABI_TYPE,
  TICKET_ABI_TYPE,
} from "./constants";

export function hashTicket(ticket: Ticket): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(TICKET_ABI_TYPE, [
      [
        ticket.value,
        ticket.senderNonce,
        ticket.receiver,
        ticket.sender,
        ticket.escrowHash,
        ticket.expiry,
        ticket.token,
      ],
    ]),
  );
}

export function hashEscrowEntry(entry: EscrowEntry): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(ESCROW_ABI_TYPE, [
      [
        entry.receiver,
        entry.sender,
        entry.value,
        entry.claimStart,
        entry.claimExpiry,
        entry.escrowHash,
        entry.token,
      ],
    ]),
  );
}

export function hashSwaps(signedSwaps: SignedSwaps): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(SIGNED_SWAPS_ABI_TYPE, [
      [signedSwaps.startIndex, signedSwaps.swaps],
    ]),
  );
}

// TODO: This was stolen from our old nitro protocol repo
// Probably a cleaner way of signing it
export function signData(hashedData: string, privateKey: string): any {
  const signingKey = new ethers.utils.SigningKey(privateKey);
  const hashedMessage = ethers.utils.hashMessage(
    ethers.utils.arrayify(hashedData),
  );
  return ethers.utils.splitSignature(signingKey.signDigest(hashedMessage));
}
