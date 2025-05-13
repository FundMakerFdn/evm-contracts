import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
// import "@nomicfoundation/hardhat-ethers"; // Commented out as hardhat-toolbox should include it
import "dotenv/config";
import "@nomicfoundation/hardhat-verify";
import "@nomicfoundation/hardhat-chai-matchers";

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      chainId: 31337,
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
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./tests",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};

export default config;
