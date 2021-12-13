import { ethers as ethersTypes } from "ethers";
import { ethers } from "hardhat";

import { L1__factory } from "../contract-types/factories/L1__factory";
import { L2__factory } from "../contract-types/factories/L2__factory";
import { L1 } from "../contract-types/L1";
import { L2, L2DepositStruct } from "../contract-types/L2";
import { TicketsWithIndex } from "../src/types";
import { hashTickets, signData } from "../src/utils";

// Address 0x2a47Cd5718D67Dc81eAfB24C99d4db159B0e7bCa
const customerPK =
  "0xe1743f0184b85ac1412311be9d6e5d333df23e22efdf615d0135ca2b9ed67938";
// Address 0xaaab35381a38c4ff4967dc29470f0f2637295983
const customer2PK =
  "0x91f47a1911c0fd985b34c25962f661f0de606f7ad38ba156902dff48b4d05f97";
// Address 0x9552ceB4e6FA8c356c1A76A8Bc8b1EFA7B9fb205
const lpPK =
  "0x23ac17b9c3590a8e67a1d1231ebab87dd2d3389d2f1526f842fd1326a0990f42";

const customerWallet = new ethers.Wallet(customerPK, ethers.provider);
const customer2Wallet = new ethers.Wallet(customer2PK, ethers.provider);
const lpWallet = new ethers.Wallet(lpPK, ethers.provider);

const l1Deployer = new L1__factory(lpWallet);
const l2Deployer = new L2__factory(lpWallet);

let lpL1: L1;
let customerL2: L2, customer2L2: L2, lpL2: L2;

async function waitForTx(
  txPromise: Promise<ethersTypes.providers.TransactionResponse>,
) {
  return (await txPromise).wait();
}

async function swap(trustedNonce: number, trustedAmount: number) {
  const depositAmount = 1;
  const deposit: L2DepositStruct = {
    trustedNonce,
    trustedAmount,
    depositAmount,
    l1Recipient: customerWallet.address,
  };
  const deposit2: L2DepositStruct = {
    ...deposit,
    l1Recipient: customer2Wallet.address,
  };

  await waitForTx(customerL2.depositOnL2(deposit, { value: depositAmount }));
  await waitForTx(customer2L2.depositOnL2(deposit2, { value: depositAmount }));

  const ticket = await lpL2.registeredTickets(trustedNonce);
  const ticket2 = await lpL2.registeredTickets(trustedNonce + 1);

  const ticketsWithIndex: TicketsWithIndex = {
    startIndex: trustedNonce,
    tickets: [ticket, ticket2],
  };
  const signature = signData(hashTickets(ticketsWithIndex), lpPK);
  await waitForTx(
    lpL2.authorizeWithdrawal(
      trustedNonce,
      trustedNonce + 1,
      signData(hashTickets(ticketsWithIndex), lpPK),
    ),
  );
  await waitForTx(lpL1.claimBatch([ticket, ticket2], signature));

  await ethers.provider.send("evm_increaseTime", [121]);
  await waitForTx(lpL2.claimL2Funds(trustedNonce));
}

beforeEach(async () => {
  const l1 = await l1Deployer.deploy();
  const l2 = await l2Deployer.deploy();

  customerL2 = l2.connect(customerWallet);
  customer2L2 = l2.connect(customer2Wallet);

  lpL2 = l2.connect(lpWallet);
  lpL1 = l1.connect(lpWallet);

  const tx = await lpWallet.sendTransaction({
    to: l1.address,
    value: ethers.utils.parseUnits("10", "wei"),
  });
  await tx.wait();
});

it("e2e ticket", async () => {
  await ticket(0, 10);
  await ticket(2, 8);
});
