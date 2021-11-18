export type Ticket = {
  value: number;
  senderNonce: number;
  receiver: string;
  sender: string;
  escrowHash: string;
  expiry: number;
  token: string;
};

export type EscrowEntry = {
  receiver: string;
  sender: string;
  claimExpiry: number;
  claimStart: number;
  escrowHash: string;
  value: number;
};
