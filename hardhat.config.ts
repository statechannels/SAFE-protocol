import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-ethers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import { HardhatUserConfig } from "hardhat/types";

const OPTIMISM_ALCHEMY_API_URL =
  "See https://www.notion.so/statechannels/Optimism-Deployment-Accounts-b861223417374b3b929824df2be3dab6";

const OPTIMISM_KOVAN_TEST_ACCOUNT =
  "See https://www.notion.so/statechannels/Optimism-Deployment-Accounts-b861223417374b3b929824df2be3dab6";

const config: HardhatUserConfig = {
  typechain: {
    outDir: "contract-types",
    target: "ethers-v5",
  },
  solidity: {
    version: "0.8.10",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    optimismKovan: {
      hardfork: "london",
      url: OPTIMISM_ALCHEMY_API_URL,
      accounts: [`${OPTIMISM_KOVAN_TEST_ACCOUNT}`],
    },

    hardhat: {
      hardfork: "london",

      accounts: [
        {
          privateKey:
            "0xe1743f0184b85ac1412311be9d6e5d333df23e22efdf615d0135ca2b9ed67938",
          balance: "10000000000000000000000",
        },
        {
          privateKey:
            "0x23ac17b9c3590a8e67a1d1231ebab87dd2d3389d2f1526f842fd1326a0990f42",
          balance: "10000000000000000000000",
        },
        {
          privateKey:
            "0x91f47a1911c0fd985b34c25962f661f0de606f7ad38ba156902dff48b4d05f97",
          balance: "10000000000000000000000",
        },
        {
          privateKey:
            "0xf3d5b8ba24833578a22960b2c7a8be1ebb7907ffe0b346111b8839e981b28b0c",
          balance: "10000000000000000000000",
        },
      ],
    },
  },
};

export default config;
