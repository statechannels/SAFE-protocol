import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-ethers";

import "hardhat-gas-reporter";
import { HardhatUserConfig } from "hardhat/types";

const config: HardhatUserConfig = {
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
