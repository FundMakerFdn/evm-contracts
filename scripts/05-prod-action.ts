import { ethers } from "hardhat";
import { generateMessageForMulticallHandler } from "../test-old/shared/utils";
import hre from "hardhat";
import {
    time,
  } from "@nomicfoundation/hardhat-toolbox/network-helpers";
async function main() {

    const [owner] = await ethers.getSigners();
    console.log('Deploying with owner', owner.address);

    const ARBI_SPOKE_POOL = "0xe35e9842fceaca96570b734083f4a58e8f7c5f2a"
    const BASE_SPOKE_POOL = "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64"
    const ARBI_MULTICALL_HANDLER = "0x924a9f036260DdD5808007E1AA95f08eD08aA569"
    const BASE_MULTICALL_HANDLER = "0x924a9f036260DdD5808007E1AA95f08eD08aA569"
    const USDC_ARBI_ADDRESS = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"
    const USDC_BASE_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    const BASE_CHAIN_ID = 8453

    const ARBI_PSYMM = "0x06f15f5F613E414117A104CD1395af8C4F6347e6"
    const BASE_PSYMM = "0x4872936e50D695c86779c32Ad91b91aFbbeFC672"
    const ARBI_SMA = "0x213d0351489aFf4EBeE830eCcf27a4A7954Cce91"

    const arbiUSDC = await ethers.getContractAt("MockERC20", USDC_ARBI_ADDRESS);
    const arbiPSYMM = await ethers.getContractAt("PSYMM", ARBI_PSYMM);
    const arbiSMA = await ethers.getContractAt("MockAcrossSMA", ARBI_SMA);
    

    
    // await
    
    
    const amount = ethers.parseUnits("1", 6);
    const minAmount = ethers.parseUnits("0.97", 6);

    await arbiUSDC.connect(owner).approve(ARBI_PSYMM, ethers.parseUnits("100", 6));
    const custodyId = ethers.keccak256(ethers.toUtf8Bytes("test-custody"));
    await arbiPSYMM.setCustodyState(custodyId, 1);
    await arbiPSYMM.connect(owner).addressToCustody(custodyId, USDC_ARBI_ADDRESS, amount);
    await arbiPSYMM.setSMAAllowance(custodyId, ARBI_SMA, true);
    await arbiPSYMM.setCustodyOwner(ARBI_SMA, true);


      // Create verification data
      const verificationData = {
        id: custodyId,
        state: 1,
        timestamp: Math.floor(Date.now() / 1000), // 1 hour from now
        pubKey: {
          parity: 0,
          x: ethers.ZeroHash
        },
        sig: {
          e: ethers.keccak256(ethers.toUtf8Bytes("test-sig")),
          s: ethers.keccak256(ethers.toUtf8Bytes("test-s"))
        },
        merkleProof: []
      };

      // generate message
      const message = await generateMessageForMulticallHandler(
        owner.address, // fallback
        BASE_PSYMM,
        custodyId,
        USDC_BASE_ADDRESS,
        minAmount
      )

      // Create call data for the SMA
      const depositFunctionSignature = "deposit(uint256,address,address,uint256,uint256,bytes)";
      const depositSelector = ethers.id(depositFunctionSignature).slice(0, 10); // Get first 4 bytes
      const fixedCallData = ethers.concat([
        depositSelector,
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "address", "address", "uint256", "uint256", "bytes"],
          [
            BASE_CHAIN_ID, // destinationChainId
            USDC_ARBI_ADDRESS, // inputToken
            USDC_BASE_ADDRESS, // outputToken
            amount, // amount
            minAmount, // minAmount
            message // empty message
          ]
        )
      ]);
      const tailCallData = "0x"; // Empty tail call data

      // Set up SMA allowances
      await arbiSMA.setInputTokenAllowed(USDC_ARBI_ADDRESS, true);
      await arbiSMA.setOutputTokenAllowed(USDC_BASE_ADDRESS, true);
      await arbiSMA.setTargetChainMulticallHandler(BASE_CHAIN_ID, BASE_MULTICALL_HANDLER);

    console.log("Depositing to SMA");
    console.log(USDC_ARBI_ADDRESS,
        ARBI_SMA,
        amount,
        fixedCallData,
        tailCallData,
        verificationData)
      await arbiPSYMM.connect(owner).custodyToSMAWithCall(
        USDC_ARBI_ADDRESS,
        ARBI_SMA,
        amount,
        fixedCallData,
        tailCallData,
        verificationData
      )


}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 