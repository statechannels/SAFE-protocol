import Table from "cli-table";
import { BigNumber, constants, Transaction, utils, Wallet } from "ethers";
import { ethers as ethersTypes } from "ethers";
import {
  EntryChainEscrow,
  EntryChainTicketStruct,
} from "../contract-types/EntryChainEscrow";
import {
  ExitChainEscrow,
  ExitChainDepositStruct,
  TicketStruct,
} from "../contract-types/ExitChainEscrow";
import { TestToken } from "../contract-types/TestToken";
import { TicketsWithNonce } from "../src/types";
import { hashTickets, signData } from "../src/utils";
import { ethers } from "hardhat";
import { SAFETY_DELAY } from "../src/constants";
import _ from "underscore";

export type ScenarioGasUsage = {
  description?: string;
  batchSize: number;
  totalGasUsed: BigNumber;
  optimismCost: BigNumber;
};

export function printScenarioGasUsage(scenarios: ScenarioGasUsage[]) {
  console.log("EntryChain claimBatch Gas Usage");
  const table = new Table({
    head: [
      "Ticket Batch Size",
      "Average Gas Per Ticket",
      "Total Gas Used",
      "Total Optimism L1 Fee",
      "Average Optimism L1 Fee Per Ticket",
    ],
    colAligns: ["right", "right", "right"],
  });
  for (const scenario of scenarios) {
    const averagePerClaim = scenario.totalGasUsed
      .div(scenario.batchSize)
      .toNumber();

    const averageOptimismCost = scenario.optimismCost
      .div(scenario.batchSize)
      .toNumber();

    table.push([
      scenario.batchSize,
      averagePerClaim,
      scenario.totalGasUsed,
      scenario.optimismCost,
      averageOptimismCost,
    ]);
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
  txPromise:
    | Promise<ethersTypes.providers.TransactionResponse>
    | ethersTypes.providers.TransactionResponse
) {
  return (await txPromise).wait();
}
export type CommonTestSetup = {
  customerWallet: ethersTypes.Wallet;
  lpWallet: ethersTypes.Wallet;
  tokenBalance: number;
  gasLimit: number;
};
export type EntryChainTestSetup = {
  entryChainToken: TestToken;
  lpEntryChain: EntryChainEscrow;
} & CommonTestSetup;

export type ExitChainTestSetup = {
  exitChainToken: TestToken;
  lpExitChain: ExitChainEscrow;
  customerExitChain: ExitChainEscrow;
} & CommonTestSetup;

export type TestSetup = EntryChainTestSetup & ExitChainTestSetup;

export async function distributeEntryChainTokens(setup: EntryChainTestSetup) {
  const { entryChainToken, lpEntryChain, customerWallet, tokenBalance } = setup;
  // Transfer 1/4 to the contract for payouts
  await waitForTx(
    entryChainToken.transfer(lpEntryChain.address, tokenBalance / 4)
  );
  // Transfer 1/4 to the customerWallet
  await entryChainToken.transfer(customerWallet.address, tokenBalance / 4);
}
export async function distributeExitChainTokens(setup: ExitChainTestSetup) {
  const { exitChainToken, lpExitChain, customerWallet, tokenBalance } = setup;

  // Transfer 1/4 to the customerWallet and approve
  await approveAndSend(
    exitChainToken,
    lpExitChain.address,
    customerWallet,
    tokenBalance / 4
  );
}

/**
 *  Approves the contractAddress to spend ERC20 for account and sends amount tokens to account
 * @param tokenContract A ERC20 contract
 * @param contractAddress The entry or exit chain contract
 * @param wallet The wallet that should approve and receive the tokens
 * @param amount The amount of tokens to send
 */
export async function approveAndSend(
  tokenContract: TestToken,
  contractAddress: string,
  wallet: Wallet,
  amount: number
): Promise<void> {
  await waitForTx(tokenContract.transfer(wallet.address, amount));
  await waitForTx(
    tokenContract.connect(wallet).approve(contractAddress, constants.MaxUint256)
  );
}

export async function deposit(
  setup: ExitChainTestSetup,
  trustedNonce: number,
  trustedAmount: number,
  entryChainRecipient?: string
): Promise<{ gasUsed: BigNumber; optimismL1Fee: BigNumber }> {
  const { customerWallet, exitChainToken, customerExitChain } = setup;
  const depositAmount = 1;
  const deposit: ExitChainDepositStruct = {
    trustedNonce,
    trustedAmount,
    depositAmount,
    entryChainRecipient: entryChainRecipient || customerWallet.address,
    token: exitChainToken.address,
  };
  const result = await customerExitChain.depositOnExitChain(deposit);
  const { gasUsed } = await waitForTx(result);
  {
    return { gasUsed, optimismL1Fee: getOptimismL1Fee(result) };
  }
}

export async function authorizeWithdrawal(
  setup: ExitChainTestSetup,
  trustedNonce: number,
  numTickets = 2
): Promise<{
  tickets: EntryChainTicketStruct[];
  signature: ethersTypes.Signature;
  gasUsed: BigNumber;
  optimismL1Fee: BigNumber;
}> {
  const { lpExitChain, gasLimit } = setup;

  const tickets: EntryChainTicketStruct[] = [];
  for (let i = 0; i < numTickets; i++) {
    tickets.push(
      ticketToEntryChainTicket(await lpExitChain.tickets(trustedNonce + i))
    );
  }

  const ticketsWithNonce: TicketsWithNonce = {
    startNonce: trustedNonce,
    tickets,
  };
  const signature = signData(hashTickets(ticketsWithNonce), lpPK);
  const authorizeResult = await lpExitChain.authorizeWithdrawal(
    trustedNonce,
    trustedNonce + numTickets - 1,
    signature,
    {
      // TODO: remove this after addressing https://github.com/statechannels/SAFE-protocol/issues/70
      gasLimit,
    }
  );
  const { gasUsed } = await waitForTx(authorizeResult);
  return {
    tickets,
    signature,
    gasUsed,
    optimismL1Fee: getOptimismL1Fee(authorizeResult),
  };
}

export function ticketToEntryChainTicket(
  ticket: TicketStruct
): EntryChainTicketStruct {
  return {
    value: ticket.value,
    entryChainRecipient: ticket.entryChainRecipient,
    token: ticket.token,
  };
}
/**
 *
 * @param testSetup A TestSetup object that contains various contracts and wallets
 * @param trustedNonce The sum of all tickets starting with trustedNonce + new deposit must be <= trustedAmount
 * @param trustedAmount amount expected to be held on EntryChain contract
 * @param numTickets number of tickets to include in the swap's batch
 * @returns receipt of the EntryChain claimBatch transaction
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
  const { lpEntryChain, gasLimit, lpExitChain } = setup;
  const entryChainTransactionReceipt = await waitForTx(
    lpEntryChain.claimBatch(tickets, signature, { gasLimit })
  );

  await ethers.provider.send("evm_increaseTime", [SAFETY_DELAY + 1]);
  await waitForTx(lpExitChain.claimExitChainFunds(trustedNonce));

  // TODO: This ought to estimate the total user cost. The cost of the EntryChain transaction
  // is currently used as a rough estimate of the total user cost.
  return entryChainTransactionReceipt;
}

/**
 * Gets the optimism L1 fee for a given transaction
 * Based on https://github.com/ethereum-optimism/optimism/blob/639e5b13f2ab94b7b49e1f8114ed05a064df8a27/packages/contracts/contracts/L2/predeploys/OVM_GasPriceOracle.sol#L150
 * @param tx
 * @returns
 */
export function getOptimismL1Fee(tx: Transaction) {
  // This is an adjustable value set in the oracle contract.
  // It can be seen here https://optimistic.etherscan.io/address/0x420000000000000000000000000000000000000f#readContract
  const overhead = 2100;

  const data = getRawTransaction(tx);
  let total = BigNumber.from(0);
  for (let i = 2; i < data.length; i++) {
    if (data.slice(i, i + 2) === "00") {
      total = total.add(4);
    } else {
      total = total.add(16);
    }
  }

  return total.add(overhead).add(68 * 16);
}

export function getRawTransaction(tx: Transaction) {
  // These are the fields that optimism will publish to L1 as call data.
  const raw = utils.serializeTransaction(
    _.pick(tx, ["nonce", "data", "gasPrice", "gasLimit", "to", "value"])
  );

  return raw;
}
