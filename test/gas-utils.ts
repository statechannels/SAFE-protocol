import { BigNumber, Transaction, utils } from "ethers";
import _ from "underscore";

function getRawTransaction(tx: Transaction) {
  const requiredFields = ["nonce", "data", "to", "value"];
  const optionalFields = ["gasLimit", "gasPrice"];
  requiredFields.map((field) => {
    if (!(tx as any)[field])
      throw new Error(`Transaction is missing field ${field}`);
  });

  // These are the fields that optimism will publish to L1 as call data.
  const raw = utils.serializeTransaction(
    _.pick(tx, [...requiredFields, ...optionalFields])
  );

  return raw;
}

/**
 * Gets the optimism L1 fee for a given transaction
 * Based on https://github.com/ethereum-optimism/optimism/blob/639e5b13f2ab94b7b49e1f8114ed05a064df8a27/packages/contracts/contracts/L2/predeploys/OVM_GasPriceOracle.sol#L150
 * @param tx
 * @returns
 */
export function getOptimismL1Fee(tx: Transaction) {
  // This is an adjustable value set in the oracle contract.
  // It can be seen here https://optimistic.etherscan.io/address/0x420000000000000000000000000000000000000f#readContract
  const overhead = 2100;

  const data = getRawTransaction(tx);
  let total = BigNumber.from(0);
  for (let i = 2; i < data.length; i += 2) {
    if (data.slice(i, i + 2) === "00") {
      total = total.add(4);
    } else {
      total = total.add(16);
    }
  }

  return total.add(overhead).add(68 * 16);
}
