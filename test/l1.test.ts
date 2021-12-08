import { ethers } from "hardhat";
import { BigNumber } from "ethers";

import {
  ALICE_PK,
  BOB_PK,
  ETH_TOKEN_ADDRESS,
  USE_ERC20,
} from "../src/constants";
import { hashTicket, signData } from "../src/utils";
import { Ticket } from "../src/types";
import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";
import { getBalances } from "./utils";
import { IERC20 } from "../contract-types/IERC20";
import { L1Contract } from "../contract-types/L1Contract";
import { L1Contract__factory } from "../contract-types/factories/L1Contract__factory";
import { TestToken__factory } from "../contract-types/factories/TestToken__factory";

import Table from "cli-table";

const alice = new ethers.Wallet(ALICE_PK, ethers.provider);
const bob = new ethers.Wallet(BOB_PK, ethers.provider);

const preimage = ethers.utils.hashMessage("Some secret preimage");
const escrowHash = ethers.utils.keccak256(preimage);

const ticketExpiry = 9_999_999_999;

const amountOfTickets = 100;
const ticketBatchSizes = [5, 20, 50, 100];
const ticketValue = 10000;
const depositValue = ticketValue * amountOfTickets * 100;

let l1Contract: L1Contract;
let tokenContract: IERC20;
use(solidity);
type GasUsed = { gasUsed: BigNumber; claims: number; batchSize: number };

const gasPerScenario: Record<string, GasUsed> = {};
after(() => {
  const table = new Table({
    head: [
      "Scenario",
      "Total Gas Used",
      "Total Claims",
      "Batch Size",
      " Average Gas Per Claim",
    ],
  });
  for (const scenario of Object.keys(gasPerScenario)) {
    const averagePerClaim = gasPerScenario[scenario].gasUsed
      .div(gasPerScenario[scenario].claims)
      .toNumber();
    table.push([
      scenario,
      gasPerScenario[scenario].gasUsed,
      gasPerScenario[scenario].claims,
      gasPerScenario[scenario].batchSize,
      averagePerClaim,
    ]);
  }
  console.log(table.toString());
});
describe(`L1 Contract using ${USE_ERC20 ? "ERC20 tokens" : "ETH"}`, () => {
  beforeEach(async () => {
    const l1Deployer = new L1Contract__factory(bob);
    l1Contract = await l1Deployer.deploy();
    const tokenDeployer = new TestToken__factory(bob);

    l1Contract = await l1Deployer.deploy();
    tokenContract = (await tokenDeployer.deploy(depositValue)) as IERC20;

    await tokenContract.approve(l1Contract.address, depositValue);
  });

  it("rejects an expired ticket", async () => {
    USE_ERC20
      ? await l1Contract.depositToken(tokenContract.address, depositValue)
      : await l1Contract.depositEth({ value: depositValue });

    const ticket: Ticket = {
      senderNonce: 1,
      value: 5,
      receiver: alice.address,
      sender: bob.address,
      escrowHash: escrowHash,
      expiry: 10,
      token: USE_ERC20 ? tokenContract.address : ETH_TOKEN_ADDRESS,
    };
    const ticketHash = hashTicket(ticket);

    const { r, s, v } = await signData(ticketHash, bob.privateKey);

    await expect(
      l1Contract.claimTicket(ticket, preimage, { r, s, v })
    ).to.be.revertedWith("The ticket is expired");
  });

  it(`can handle ${amountOfTickets} tickets being claimed sequentially`, async () => {
    const ticketGasUsage = {
      gasUsed: BigNumber.from(0),
      claims: 0,
      batchSize: 0,
    };
    const initialBalances = await getBalances(alice, bob, tokenContract);

    USE_ERC20
      ? await l1Contract.depositToken(tokenContract.address, depositValue)
      : await l1Contract.depositEth({ value: depositValue });

    const tickets: Ticket[] = [];
    const ticketSignatures = [];
    for (let i = 0; i < amountOfTickets; i++) {
      const newTicket = {
        senderNonce: i,
        value: ticketValue,
        receiver: alice.address,
        sender: bob.address,
        escrowHash: escrowHash,
        expiry: ticketExpiry,
        token: USE_ERC20 ? tokenContract.address : ETH_TOKEN_ADDRESS,
      };

      const ticketHash = hashTicket(newTicket);

      const signature = await signData(ticketHash, bob.privateKey);

      tickets.push(newTicket);
      ticketSignatures.push(signature);
    }
    for (let i = 0; i < tickets.length; i++) {
      const { r, s, v } = ticketSignatures[i];

      const result = await l1Contract.claimTicket(tickets[i], preimage, {
        r,
        s,
        v,
      });
      ticketGasUsage.gasUsed = ticketGasUsage.gasUsed.add(
        (await result.wait()).gasUsed
      );
      ticketGasUsage.claims++;
    }
    const finalBalances = await getBalances(alice, bob, tokenContract);

    const expectedTotalTransferred = BigNumber.from(
      amountOfTickets * ticketValue
    );
    const actualTotalTransferred = finalBalances.alice.sub(
      initialBalances.alice
    );

    expect(expectedTotalTransferred.eq(actualTotalTransferred)).to.be.true;

    gasPerScenario["sequential claims"] = ticketGasUsage;
  });
  for (const ticketBatchSize of ticketBatchSizes) {
    it(`can handle a claim of ${amountOfTickets} tickets in batch sizes of ${ticketBatchSize}`, async () => {
      const ticketGasUsage = {
        gasUsed: BigNumber.from(0),
        claims: 0,
        batchSize: ticketBatchSize,
      };
      const initialBalances = await getBalances(alice, bob, tokenContract);

      USE_ERC20
        ? await l1Contract.depositToken(tokenContract.address, depositValue)
        : await l1Contract.depositEth({ value: depositValue });

      const tickets: Ticket[] = [];
      const ticketSignatures = [];
      for (let i = 0; i < amountOfTickets; i++) {
        const newTicket = {
          senderNonce: i,
          value: ticketValue,
          receiver: alice.address,
          sender: bob.address,
          escrowHash: escrowHash,
          expiry: ticketExpiry,
          token: USE_ERC20 ? tokenContract.address : ETH_TOKEN_ADDRESS,
        };

        const ticketHash = hashTicket(newTicket);
        const signature = await signData(ticketHash, bob.privateKey);

        tickets.push(newTicket);
        ticketSignatures.push(signature);
      }
      const preimages = new Array(amountOfTickets).fill(preimage);

      for (
        let i = ticketBatchSize;
        i <= tickets.length;
        i = i + ticketBatchSize
      ) {
        const result = await l1Contract.claimTickets(
          tickets.slice(i - ticketBatchSize, i),
          preimages.slice(i - ticketBatchSize, i),
          ticketSignatures.slice(i - ticketBatchSize, i)
        );

        ticketGasUsage.gasUsed = ticketGasUsage.gasUsed.add(
          (await result.wait()).gasUsed
        );
        ticketGasUsage.claims += ticketBatchSize;
      }

      const finalBalances = await getBalances(alice, bob, tokenContract);

      const expectedTotalTransferred = BigNumber.from(
        amountOfTickets * ticketValue
      );
      const actualTotalTransferred = finalBalances.alice.sub(
        initialBalances.alice
      );

      expect(expectedTotalTransferred.eq(actualTotalTransferred)).to.be.true;
      gasPerScenario[`batched claims ${ticketBatchSize}`] = ticketGasUsage;
    });
  }
});
