import { ethers } from "hardhat";

import { L1__factory } from "../contract-types/factories/L1__factory";
import { L2__factory } from "../contract-types/factories/L2__factory";
import { L2DepositStruct } from "../contract-types/L2";
import { SignedSwaps } from "../src/types";
import { hashSwaps, signData } from "../src/utils";

// Address 0x2a47Cd5718D67Dc81eAfB24C99d4db159B0e7bCa
const customerPK =
  "0xe1743f0184b85ac1412311be9d6e5d333df23e22efdf615d0135ca2b9ed67938";
// Address 0x9552ceB4e6FA8c356c1A76A8Bc8b1EFA7B9fb205
const lpPK =
  "0x23ac17b9c3590a8e67a1d1231ebab87dd2d3389d2f1526f842fd1326a0990f42";

const customerWallet = new ethers.Wallet(customerPK, ethers.provider);
const lpWallet = new ethers.Wallet(customerPK, ethers.provider);

const l1Deployer = new L1__factory(lpWallet);
const l2Deployer = new L2__factory(lpWallet);

it.only("e2e swap", async () => {
  const l1 = await l1Deployer.deploy();
  const l2 = await l2Deployer.deploy();

  const customerL2 = l2.connect(customerWallet);
  const lpL2 = l2.connect(lpWallet);
  const lpL1 = l1.connect(lpWallet);

  const deposit: L2DepositStruct = {
    trustedNonce: 0,
    trustedAmount: 10,
    depositAmount: 1,
    l1Recipient: customerWallet.address,
  };

  await customerL2.depositOnL2(deposit);

  const swap = await lpL2.registeredSwaps(0);

  const signedSwaps: SignedSwaps = { startIndex: 0, swaps: [swap] };
  const signature = signData(hashSwaps(signedSwaps), lpPK);
  await lpL2.authorizeWithdrawal(0, 0, signData(hashSwaps(signedSwaps), lpPK));
  await lpL1.claimBatch([swap], signature);

  await ethers.provider.send("evm_increaseTime", [121]);
  await lpL2.claimL2Funds(0);
});
