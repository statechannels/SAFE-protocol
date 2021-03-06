import { TicketsWithNonce } from "./types";
import { ethers } from "ethers";
import { SIGNED_SWAPS_ABI_TYPE } from "./constants";

export function hashTickets(ticketsWithNonce: TicketsWithNonce): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(SIGNED_SWAPS_ABI_TYPE, [
      [ticketsWithNonce.startNonce, ticketsWithNonce.tickets],
    ])
  );
}

// TODO: This was stolen from our old nitro protocol repo
// Probably a cleaner way of signing it
export function signData(
  hashedData: string,
  privateKey: string
): ethers.Signature {
  const signingKey = new ethers.utils.SigningKey(privateKey);
  const hashedMessage = ethers.utils.hashMessage(
    ethers.utils.arrayify(hashedData)
  );
  return ethers.utils.splitSignature(signingKey.signDigest(hashedMessage));
}
