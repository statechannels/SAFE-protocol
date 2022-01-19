import { utils } from "ethers";
import { ethers } from "hardhat";

const TX_HASH =
  "0x4315324018b6e9bd8b2b0e0d04479dc934bfdbc1ae6bebc0b4e41544b6b106bf";

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
