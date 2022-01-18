import { utils } from "ethers";
import { ethers } from "hardhat";

const TX_HASH =
  "0xc45cea890d83ed2084fa9996c29bdb9efeccad14c514abb8d8553735a81e884a";

async function getRaw() {
  const transaction = await ethers.provider.getTransaction(TX_HASH);
  console.log("TX HASH", TX_HASH);
  console.log("RAW", getRawTransaction(transaction));
}

function getRawTransaction(tx: any) {
  function addKey(accum: any, key: any) {
    if (tx[key]) {
      accum[key] = tx[key];
    }
    return accum;
  }

  // Extract the relevant parts of the transaction and signature
  const txFields = "data gasPrice gasLimit nonce to value".split(" ");

  const raw = utils.serializeTransaction(txFields.reduce(addKey, {}));

  return raw;
}

getRaw()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
