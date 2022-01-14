import Table from "cli-table";
import { BigNumber, Wallet } from "ethers";
import { ethers as ethersTypes } from "ethers";
import { Entry, EntryTicketStruct } from "../contract-types/Entry";
import { Exit, ExitDepositStruct, TicketStruct } from "../contract-types/Exit";
import { TestToken } from "../contract-types/TestToken";
import { TicketsWithNonce } from "../src/types";
import { hashTickets, signData } from "../src/utils";
import { ethers } from "hardhat";
import { SAFETY_DELAY } from "../src/constants";

export type ScenarioGasUsage = {
  batchSize: number;
  totalGasUsed: BigNumber;
};

export function printScenarioGasUsage(scenarios: ScenarioGasUsage[]) {
  console.log("Entry claimBatch Gas Usage");
  const table = new Table({
    head: ["Ticket Batch Size", "Average Gas Per Ticket", "Total Gas Used"],
    colAligns: ["right", "right", "right"],
  });
  for (const scenario of scenarios) {
    const averagePerClaim = scenario.totalGasUsed
      .div(scenario.batchSize)
      .toNumber();
    table.push([scenario.batchSize, averagePerClaim, scenario.totalGasUsed]);
  }
  console.log(table.toString());
}
// Address 0x2a47Cd5718D67Dc81eAfB24C99d4db159B0e7bCa
export const customerPK =
  "0xe1743f0184b85ac1412311be9d6e5d333df23e22efdf615d0135ca2b9ed67938";
// Address 0x9552ceB4e6FA8c356c1A76A8Bc8b1EFA7B9fb205
export const lpPK =
  "0x23ac17b9c3590a8e67a1d1231ebab87dd2d3389d2f1526f842fd1326a0990f42";

// pk = 0x91f47a1911c0fd985b34c25962f661f0de606f7ad38ba156902dff48b4d05f97
export const customer2Address = "0xAAAB35381A38C4fF4967DC29470F0f2637295983";

export async function waitForTx(
  txPromise: Promise<ethersTypes.providers.TransactionResponse>
) {
  return (await txPromise).wait();
}
export type CommonTestSetup = {
  customerWallet: ethersTypes.Wallet;
  lpWallet: ethersTypes.Wallet;
  tokenBalance: number;
  gasLimit: number;
};
export type EntryTestSetup = {
  entryToken: TestToken;
  lpEntry: Entry;
} & CommonTestSetup;

export type ExitTestSetup = {
  exitToken: TestToken;
  lpExit: Exit;
  customerExit: Exit;
} & CommonTestSetup;

export type TestSetup = EntryTestSetup & ExitTestSetup;

export async function distributeEntryTokens(setup: EntryTestSetup) {
  const { entryToken, lpEntry, customerWallet, tokenBalance } = setup;

  await approveAndDistribute(
    entryToken,
    lpEntry.address,
    customerWallet,
    tokenBalance
  );
}
export async function distributeExitTokens(setup: ExitTestSetup) {
  const { exitToken, lpExit, customerWallet, tokenBalance } = setup;
  await approveAndDistribute(
    exitToken,
    lpExit.address,
    customerWallet,
    tokenBalance
  );
}

async function approveAndDistribute(
  testToken: TestToken,
  contractAddress: string,
  customerWallet: Wallet,
  tokenBalance: number
): Promise<void> {
  // Transfer 1/4 to the customer account
  await testToken.transfer(customerWallet.address, tokenBalance / 4);

  // Transfer 1/4 to the  contract for payouts
  await testToken.transfer(contractAddress, tokenBalance / 4);

  // Approve transfers for the contract
  await testToken.approve(contractAddress, tokenBalance);

  // Approve transfers for the contract for the customer
  await testToken
    .connect(customerWallet)
    .approve(contractAddress, tokenBalance);
}

export async function deposit(
  setup: ExitTestSetup,
  trustedNonce: number,
  trustedAmount: number,
  entryRecipient?: string
) {
  const { customerWallet, exitToken, customerExit } = setup;
  const depositAmount = 1;
  const deposit: ExitDepositStruct = {
    trustedNonce,
    trustedAmount,
    depositAmount,
    entryRecipient: entryRecipient || customerWallet.address,
    token: exitToken.address,
  };

  await waitForTx(
    customerExit.depositOnExit(deposit, { value: depositAmount })
  );
}

export async function authorizeWithdrawal(
  setup: ExitTestSetup,
  trustedNonce: number,
  numTickets = 2
): Promise<{ tickets: EntryTicketStruct[]; signature: ethersTypes.Signature }> {
  const { lpExit, gasLimit } = setup;

  const tickets: EntryTicketStruct[] = [];
  for (let i = 0; i < numTickets; i++) {
    tickets.push(ticketToEntryTicket(await lpExit.tickets(trustedNonce + i)));
  }

  const ticketsWithNonce: TicketsWithNonce = {
    startNonce: trustedNonce,
    tickets,
  };
  const signature = signData(hashTickets(ticketsWithNonce), lpPK);
  await waitForTx(
    lpExit.authorizeWithdrawal(
      trustedNonce,
      trustedNonce + numTickets - 1,
      signature,
      {
        // TODO: remove this after addressing https://github.com/statechannels/SAFE-protocol/issues/70
        gasLimit,
      }
    )
  );
  return { tickets, signature };
}

export function ticketToEntryTicket(ticket: TicketStruct): EntryTicketStruct {
  return {
    value: ticket.value,
    entryRecipient: ticket.entryRecipient,
    token: ticket.token,
  };
}
/**
 *
 * @param testSetup A TestSetup object that contains various contracts and wallets
 * @param trustedNonce The sum of all tickets starting with trustedNonce + new deposit must be <= trustedAmount
 * @param trustedAmount amount expected to be held on Entry contract
 * @param numTickets number of tickets to include in the swap's batch
 * @returns receipt of the Entry claimBatch transaction
 */
export async function swap(
  setup: TestSetup,
  trustedNonce: number,
  trustedAmount: number,

  numTickets = 2
) {
  for (let i = 0; i < numTickets; i++) {
    await deposit(setup, trustedNonce, trustedAmount);
  }
  const { tickets, signature } = await authorizeWithdrawal(
    setup,
    trustedNonce,
    numTickets
  );
  const { lpEntry, gasLimit, lpExit } = setup;
  const entryTransactionReceipt = await waitForTx(
    lpEntry.claimBatch(tickets, signature, { gasLimit })
  );

  await ethers.provider.send("evm_increaseTime", [SAFETY_DELAY + 1]);
  await waitForTx(lpExit.claimExitFunds(trustedNonce));

  // TODO: This ought to estimate the total user cost. The cost of the Entry transaction
  // is currently used as a rough estimate of the total user cost.
  return entryTransactionReceipt;
}
