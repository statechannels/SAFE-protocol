import { ethers } from "hardhat";
import { L2__factory } from "../../contract-types/factories/L2__factory";
import { TestToken__factory } from "../../contract-types/factories/TestToken__factory";
const tokenBalance = 1_000_000;

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  console.log("Account balance:", (await deployer.getBalance()).toString());

  const l2Deployer = new L2__factory(deployer);
  const tokenDeployer = new TestToken__factory(deployer);

  const token = await tokenDeployer.deploy(tokenBalance);
  console.log(`Token contract deployed at ${token.address}`);
  const l2 = await l2Deployer.deploy();
  console.log(`Exit chain contract deployed at ${l2.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
