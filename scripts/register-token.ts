import { ethers } from "hardhat";
import { L2__factory } from "../contract-types/factories/L2__factory";
import { TestToken__factory } from "../contract-types/factories/TestToken__factory";

const EXIT_TOKEN_CONTRACT_ADDRESS =
  "0xBe4b63A8234848eB5514fC68eb6BF6B6FEa5B5cb";
const ENTRY_TOKEN_CONTRACT_ADDRESS;
const EXIT_CONTRACT_ADDRESS = "0xBEaCdfeE27A6ED04A682445b93A9AAff1Ebe5c84";
async function register() {
  const [customer] = await ethers.getSigners();

  const l2Factory = new L2__factory(customer);
  const tokenFactory = new TestToken__factory(customer);
  const l2 = l2Factory.attach(EXIT_CONTRACT_ADDRESS);
  const token = tokenFactory.attach(EXIT_TOKEN_CONTRACT_ADDRESS);
  const randomAddress = ethers.Wallet.createRandom().address;

  const result = await l2.registerTokenPairs([
    { l1Token: randomAddress, l2Token: token.address },
  ]);
  console.log(result);
  await result.wait();
}

register()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
