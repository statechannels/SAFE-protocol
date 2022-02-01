import Table from "cli-table";
import { BigNumber, constants, Wallet, ethers as ethersTypes } from "ethers";

import {
  ToChainEscrow,
  ToChainTicketStruct,
} from "../contract-types/ToChainEscrow";
import {
  FromChainEscrow,
  FromChainDepositStruct,
  TicketStruct,
  TokenPairStruct,
} from "../contract-types/FromChainEscrow";
import { TestToken } from "../contract-types/TestToken";
import { TicketsWithNonce } from "../src/types";
import { hashTickets, signData } from "../src/utils";
import { ethers } from "hardhat";
import { SAFETY_DELAY } from "../src/constants";
import { getOptimismL1Fee } from "./gas-utils";

export type ScenarioGasUsage = {
  description?: string;
  batchSize: number;
  totalGasUsed: BigNumber;
  optimismCost: BigNumber;
};

export function printScenarioGasUsage(scenarios: ScenarioGasUsage[]) {
  console.log("ToChain claimBatch Gas Usage");
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
export type ToChainTestSetup = {
  toChainToken: TestToken;
  lpToChain: ToChainEscrow;
} & CommonTestSetup;

export type FromChainTestSetup = {
  fromChainToken: TestToken;
  lpFromChain: FromChainEscrow;
  customerFromChain: FromChainEscrow;
} & CommonTestSetup;

export type TestSetup = ToChainTestSetup & FromChainTestSetup;

export async function distributeToChainTokens(setup: ToChainTestSetup) {
  const { toChainToken, lpToChain, customerWallet, tokenBalance } = setup;
  // Transfer 1/4 to the contract for payouts
  await waitForTx(toChainToken.transfer(lpToChain.address, tokenBalance / 4));
  // Transfer 1/4 to the customerWallet
  await toChainToken.transfer(customerWallet.address, tokenBalance / 4);
}
export async function distributeFromChainTokens(setup: FromChainTestSetup) {
  const { fromChainToken, lpFromChain, customerWallet, tokenBalance } = setup;

  // Transfer 1/4 to the customerWallet and approve
  await approveAndSend(
    fromChainToken,
    lpFromChain.address,
    customerWallet,
    tokenBalance / 4
  );
}

/**
 *  Approves the contractAddress to spend ERC20 for account and sends amount tokens to account
 * @param tokenContract A ERC20 contract
 * @param contractAddress The to or from chain contract
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
  setup: FromChainTestSetup,
  trustedNonce: number,
  trustedAmount: number,
  toChainRecipient?: string
): Promise<{ gasUsed: BigNumber; optimismL1Fee: BigNumber }> {
  const { customerWallet, fromChainToken, customerFromChain } = setup;
  const depositAmount = 1;
  const deposit: FromChainDepositStruct = {
    trustedNonce,
    trustedAmount,
    depositAmount,
    toChainRecipient: toChainRecipient || customerWallet.address,
    token: fromChainToken.address,
  };
  const result = await customerFromChain.depositOnFromChain(deposit);
  const { gasUsed } = await waitForTx(result);
  {
    return { gasUsed, optimismL1Fee: getOptimismL1Fee(result) };
  }
}

export async function authorizeWithdrawal(
  setup: FromChainTestSetup,
  trustedNonce: number,
  numTickets = 2
): Promise<{
  tickets: ToChainTicketStruct[];
  signature: ethersTypes.Signature;
  gasUsed: BigNumber;
  optimismL1Fee: BigNumber;
}> {
  const { lpFromChain, gasLimit } = setup;

  const tickets: ToChainTicketStruct[] = [];
  for (let i = 0; i < numTickets; i++) {
    tickets.push(
      ticketToToChainTicket(await lpFromChain.tickets(trustedNonce + i))
    );
  }

  const ticketsWithNonce: TicketsWithNonce = {
    startNonce: trustedNonce,
    tickets,
  };
  const signature = signData(hashTickets(ticketsWithNonce), lpPK);
  const authorizeResult = await lpFromChain.authorizeWithdrawal(
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

export function ticketToToChainTicket(
  ticket: TicketStruct
): ToChainTicketStruct {
  return {
    value: ticket.value,
    toChainRecipient: ticket.toChainRecipient,
    token: ticket.token,
  };
}
/**
 *
 * @param testSetup A TestSetup object that contains various contracts and wallets
 * @param trustedNonce The sum of all tickets starting with trustedNonce + new deposit must be <= trustedAmount
 * @param trustedAmount amount expected to be held on ToChain contract
 * @param numTickets number of tickets to include in the swap's batch
 * @returns receipt of the ToChain claimBatch transaction
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
  const { lpToChain, gasLimit, lpFromChain } = setup;
  const toChainTransactionReceipt = await waitForTx(
    lpToChain.claimBatch(tickets, signature, { gasLimit })
  );

  await ethers.provider.send("evm_increaseTime", [SAFETY_DELAY + 1]);
  await waitForTx(lpFromChain.claimFromChainFunds(trustedNonce));

  // TODO: This ought to estimate the total user cost. The cost of the ToChain transaction
  // is currently used as a rough estimate of the total user cost.
  return toChainTransactionReceipt;
}

export type TokenInfo = { pair: TokenPairStruct; contract: TestToken };
export async function createCustomer(
  lpWallet: Wallet,
  contractAddress: string,
  tokens: TokenInfo[]
): Promise<Wallet> {
  const wallet = Wallet.createRandom({}).connect(ethers.provider);

  // Send some ETH to the customer for gas fees
  const fundTx = { to: wallet.address, value: ethers.utils.parseEther("1") };
  await waitForTx(lpWallet.sendTransaction(fundTx));

  // Approve the contract to spend the token for the user and send them a small amount
  for (const token of tokens) {
    await approveAndSend(token.contract, contractAddress, wallet, 100);
  }

  return wallet;
}
