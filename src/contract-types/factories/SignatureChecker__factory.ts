/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import { Contract, Signer, utils } from "ethers";
import { Provider } from "@ethersproject/providers";
import type {
  SignatureChecker,
  SignatureCheckerInterface,
} from "../SignatureChecker";

const _abi = [
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "hash",
        type: "bytes32",
      },
      {
        components: [
          {
            internalType: "bytes32",
            name: "r",
            type: "bytes32",
          },
          {
            internalType: "bytes32",
            name: "s",
            type: "bytes32",
          },
          {
            internalType: "uint8",
            name: "v",
            type: "uint8",
          },
        ],
        internalType: "struct Signature",
        name: "signature",
        type: "tuple",
      },
    ],
    name: "recoverSigner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "pure",
    type: "function",
  },
];

export class SignatureChecker__factory {
  static readonly abi = _abi;
  static createInterface(): SignatureCheckerInterface {
    return new utils.Interface(_abi) as SignatureCheckerInterface;
  }
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): SignatureChecker {
    return new Contract(address, _abi, signerOrProvider) as SignatureChecker;
  }
}