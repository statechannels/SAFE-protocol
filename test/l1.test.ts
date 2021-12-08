import { ethers } from "hardhat";
import { BigNumber } from "ethers";

import { ALICE_PK, BOB_PK, ETH_TOKEN_ADDRESS } from "../src/constants";
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
const ticketBatchSizes = [1, 5, 20, 50, 100];
const ticketValue = 10000;
const depositValue = ticketValue * amountOfTickets * 100;

let l1Contract: L1Contract;
let tokenContract: IERC20;

use(solidity);

export type TransferType = "ERC20" | "ETH";

type Scenario = {
  transferType: TransferType;
  batchSize: number;
  amountOfTickets: number;
};

type ScenarioGasUsage = Scenario & {
  totalGasUsed: BigNumber;
};

const scenarios: Scenario[] = [
  { transferType: "ETH", batchSize: 1, amountOfTickets: 100 },
  { transferType: "ETH", batchSize: 5, amountOfTickets: 100 },
  { transferType: "ETH", batchSize: 20, amountOfTickets: 100 },
  { transferType: "ETH", batchSize: 50, amountOfTickets: 100 },
  { transferType: "ETH", batchSize: 100, amountOfTickets: 100 },
  { transferType: "ERC20", batchSize: 1, amountOfTickets: 100 },
  { transferType: "ERC20", batchSize: 5, amountOfTickets: 100 },
  { transferType: "ERC20", batchSize: 20, amountOfTickets: 100 },
  { transferType: "ERC20", batchSize: 50, amountOfTickets: 100 },
  { transferType: "ERC20", batchSize: 100, amountOfTickets: 100 },
];

const gasUsageScenarios: ScenarioGasUsage[] = [];
after(() => {
  const table = new Table({
    head: [
      "Transfer Type",
      "Total Gas Used",
      "Total Claims",
      "Batch Size",
      " Average Gas Per Claim",
    ],
  });
  for (const scenario of gasUsageScenarios) {
    const averagePerClaim = scenario.totalGasUsed
      .div(scenario.amountOfTickets)
      .toNumber();
    table.push([
      scenario.transferType,
      scenario.totalGasUsed,
      scenario.amountOfTickets,
      scenario.batchSize,
      averagePerClaim,
    ]);
  }
  console.log(table.toString());
});
describe(`L1 Contract`, () => {
  beforeEach(async () => {
    const l1Deployer = new L1Contract__factory(bob);
    l1Contract = await l1Deployer.deploy();
    const tokenDeployer = new TestToken__factory(bob);

    l1Contract = await l1Deployer.deploy();
    tokenContract = (await tokenDeployer.deploy(depositValue)) as IERC20;

    await tokenContract.approve(l1Contract.address, depositValue);
  });

  it.skip("rejects an expired ticket", async () => {
    await l1Contract.depositEth({ value: depositValue });

    const ticket: Ticket = {
      senderNonce: 1,
      value: 5,
      receiver: alice.address,
      sender: bob.address,
      escrowHash: escrowHash,
      expiry: 10,
      token: ETH_TOKEN_ADDRESS,
    };
    const ticketHash = hashTicket(ticket);

    const { r, s, v } = await signData(ticketHash, bob.privateKey);

    await expect(
      l1Contract.claimTicket(ticket, preimage, { r, s, v })
    ).to.be.revertedWith("The ticket is expired");
  });
  for (const scenario of scenarios) {
    it(`can handle a claim of ${scenario.amountOfTickets} tickets in batch sizes of ${scenario.batchSize} using ${scenario.transferType}`, async () => {
      const initialBalances = await getBalances(
        alice,
        bob,
        tokenContract,
        scenario.transferType
      );

      scenario.transferType === "ERC20"
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
          token:
            scenario.transferType === "ERC20"
              ? tokenContract.address
              : ETH_TOKEN_ADDRESS,
        };

        const ticketHash = hashTicket(newTicket);
        const signature = await signData(ticketHash, bob.privateKey);

        tickets.push(newTicket);
        ticketSignatures.push(signature);
      }
      const preimages = new Array(amountOfTickets).fill(preimage);

      let totalGasUsed = BigNumber.from(0);

      for (
        let i = scenario.batchSize;
        i <= tickets.length;
        i = i + scenario.batchSize
      ) {
        const result = await l1Contract.claimTickets(
          tickets.slice(i - scenario.batchSize, i),
          preimages.slice(i - scenario.batchSize, i),
          ticketSignatures.slice(i - scenario.batchSize, i)
        );

        totalGasUsed = totalGasUsed.add((await result.wait()).gasUsed);
      }

      const finalBalances = await getBalances(
        alice,
        bob,
        tokenContract,
        scenario.transferType
      );

      const expectedTotalTransferred = BigNumber.from(
        amountOfTickets * ticketValue
      );
      const actualTotalTransferred = finalBalances.alice.sub(
        initialBalances.alice
      );

      expect(expectedTotalTransferred.eq(actualTotalTransferred)).to.be.true;

      gasUsageScenarios.push({ ...scenario, totalGasUsed });
    });
  }
});
