import { ethers } from "hardhat";
import { L2__factory } from "../contract-types/factories/L2__factory";
import { TestToken__factory } from "../contract-types/factories/TestToken__factory";
import {
  approveAndDistribute,
  authorizeWithdrawal,
  deposit,
  L2TestSetup,
} from "../test/utils";
const TOKEN_CONTRACT_ADDRESS = "0xBe4b63A8234848eB5514fC68eb6BF6B6FEa5B5cb";
const EXIT_CONTRACT_ADDRESS = "0xBEaCdfeE27A6ED04A682445b93A9AAff1Ebe5c84";

// A fake address for now
const L1_TOKEN_ADDRESS = "0xaed79241a87f47CcFfb16Ea6b73dFa7AaCA22654";
export async function runBenchmark() {
  const [lp] = await ethers.getSigners();

  const l2Factory = new L2__factory(lp);
  const tokenFactory = new TestToken__factory(lp);
  const l2 = l2Factory.attach(EXIT_CONTRACT_ADDRESS);
  const token = tokenFactory.attach(TOKEN_CONTRACT_ADDRESS);
  const tokenBalance = 1_000_000;
  const gasLimit = 30_000_000;
  //0xc056A6243eABD82C4c6d10105bC511Cd6288382C
  const customerWallet = new ethers.Wallet(
    "0x650977336733b2efad10f195be65686cd22d5bc616b443d453e6d665900670b7"
  ).connect(ethers.provider);

  const lpWallet = new ethers.Wallet(
    "0x4862f7705912de8a028dc866d65460555bdea25706556648bc6536bb73462f7b"
  ).connect(ethers.provider).
  const tx = {
    to: customerWallet.address,
    value: 10000000000000,
  };
  const sendResult = await lpWallet.sendTransaction(tx);
  await sendResult.wait();
  await approveAndDistribute(token, EXIT_CONTRACT_ADDRESS, customerWallet, 100);
  // Approve transfers for the contract
  await token
    .connect(customerWallet)
    .approve(EXIT_CONTRACT_ADDRESS, tokenBalance);
  console.log("approved and distributed");
  const setup: L2TestSetup = {
    l2Token: token,
    lpL2: l2,
    customerL2: l2.connect(customerWallet),
    customerWallet,
    tokenBalance,
    gasLimit,
    lpWallet: new ethers.Wallet(
      "0x4862f7705912de8a028dc866d65460555bdea25706556648bc6536bb73462f7b"
    ).connect(ethers.provider),
  };
  const numTickets = 2;
  const trustedNonce = 10;
  for (let i = 0; i < numTickets; i++) {
    await deposit(setup, trustedNonce, numTickets, customerWallet.address);
  }
  console.log("deposited");
  const { tickets, signature } = await authorizeWithdrawal(
    setup,
    10,
    numTickets
  );
  console.log("authorized");
  const result = await l2.claimL2Funds(trustedNonce);
  await result.wait();
  console.log("claimed");
}

runBenchmark()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
