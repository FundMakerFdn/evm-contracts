import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";
import "@nomicfoundation/hardhat-verify";

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      chainId: 1337,
    },
    arbitrum: {
      url: "https://arb1.lava.build",
      accounts: [process.env.PRIVATE_KEY!],
    },
    base: {
      url: "https://base.llamarpc.com",
      accounts: [process.env.PRIVATE_KEY!],
    },
  },
  etherscan: {
    apiKey: {
      arbitrumOne: "58XEYVEA8DWCHWNZM7VPZNTEKG994RPJA3",
      base: "4N8Y184P2UCBXPF9WMB4C6F5NWXPPX86IW",
    },
  },
  solidity: {
    version: "0.8.28", // any version you want
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        details: {
          yulDetails: {
            optimizerSteps: "u",
          },
        },
      },
    },
  }
};

export default config;
