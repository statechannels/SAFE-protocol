import axios from "axios";
import { getOptimismL1Fee } from "./gas-utils";
import { Transaction } from "ethers";

const ropstenPrepare =
  "0xac31b7d16480131c32ec8d9b59e467e0daede3aa01fdd10514db4901f8f6675c";
const ropstenFulfill =
  "0x4d0342698f1b68038f9612d665e72c10a93c8c59f91625dacf29d4fa3bb21f97";
const goerliPrepare =
  "0xe45f5f0e79dafd3cf5ce6f4a0201709d3b9e171bcb1bf6591a67d6a28f18ff57";
const goerliFulfill =
  "0x4315324018b6e9bd8b2b0e0d04479dc934bfdbc1ae6bebc0b4e41544b6b106bf";

const txs = [
  ["Ropsten Prepare", ropstenPrepare, "ropsten"],
  ["Ropsten Fulfill", ropstenFulfill, "ropsten"],
  ["Goerli Prepare", goerliPrepare, "goerli"],
  ["Goerli Fulfill", goerliFulfill, "goerli"],
];

async function optimismFee(txLabel: string, txHash: string, network: string) {
  const response = await axios.get(
    `https://api-${network}.etherscan.io/api?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=I9ZCY7RANFT7I44TSVDUI8Z8VUDPP5M32Q`
  );
  const tx: Transaction = {
    ...response.data.result,
    data: response.data.result.input,
  };

  const fee = getOptimismL1Fee(tx);
  console.log(`${txLabel}: ${fee}`);
}

async function main() {
  for (const tx of txs) {
    await optimismFee(tx[0], tx[1], tx[2]);
  }
}

main();
