import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-ethers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import { HardhatUserConfig } from "hardhat/types";

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
      ],
    },
  },
};

export default config;
