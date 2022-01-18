import { utils } from "ethers";
import { ethers } from "hardhat";
import { L2__factory } from "../contract-types/factories/L2__factory";
import { TestToken__factory } from "../contract-types/factories/TestToken__factory";
import { L2DepositStruct } from "../contract-types/L2";

const TOKEN_CONTRACT_ADDRESS = "0xBe4b63A8234848eB5514fC68eb6BF6B6FEa5B5cb";
const EXIT_CONTRACT_ADDRESS = "0xBEaCdfeE27A6ED04A682445b93A9AAff1Ebe5c84";
async function deposit() {
  const [customer] = await ethers.getSigners();

  const l2Factory = new L2__factory(customer);
  const tokenFactory = new TestToken__factory(customer);
  const l2 = l2Factory.attach(EXIT_CONTRACT_ADDRESS);
  const token = tokenFactory.attach(TOKEN_CONTRACT_ADDRESS);
  const tokenBalance = 1_000_000;

  // Approve transfers for the contract
  const approveResult = await token.approve(l2.address, tokenBalance);
  await approveResult.wait();
  const depositAmount = 1;
  const deposit: L2DepositStruct = {
    trustedNonce: 100,
    trustedAmount: 100000,
    depositAmount,
    l1Recipient: customer.address,
    token: token.address,
  };
  const result = await l2.depositOnL2(deposit);
  console.log(result);
  console.log(getRawTransaction(result));
  const nodeResponse = await ethers.provider.send(
    "eth_getRawTransactionByBlockHash",
    [result.hash]
  );
  console.log(nodeResponse);
  await result.wait();
}
deposit()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

function getRawTransaction(tx: any) {
  function addKey(accum: any, key: any) {
    if (tx[key]) {
      accum[key] = tx[key];
    }
    return accum;
  }

  // Extract the relevant parts of the transaction and signature
  const txFields =
    "accessList chainId data gasPrice gasLimit maxFeePerGas maxPriorityFeePerGas nonce to type value".split(
      " "
    );

  // Seriailze the signed transaction
  console.log("reduced", txFields.reduce(addKey, {}));
  const raw = utils.serializeTransaction(txFields.reduce(addKey, {}));

  return raw;
}
