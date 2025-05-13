import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { PPMHelper } from "./utils/ppmHelper";
import { SchnorrHelper } from "./utils/schnorrHelper";
import { ethers } from "hardhat";

describe("UniswapV3SMA", function () {
  // We define a fixture to reuse the same setup in every test
  async function deployUniswapFixture() {
    // Get signers
    const [owner, user1, user2] = await ethers.getSigners();

    // Deploy mock tokens
    const mockTokenFactory = await ethers.getContractFactory("MockERC20");
    const tokenA = await mockTokenFactory.deploy("Token A", "TKNA", 18);
    const tokenB = await mockTokenFactory.deploy("Token B", "TKNB", 18);
    
    // Deploy mock Uniswap V3 Router
    const mockRouterFactory = await ethers.getContractFactory("MockUniswapV3Router");
    const mockRouter = await mockRouterFactory.deploy();
    
    // Set exchange rates in the mock
    const rateAtoB = ethers.parseUnits("2", 18); // 1 Token A = 2 Token B
    const rateBtoA = ethers.parseUnits("0.5", 18); // 1 Token B = 0.5 Token A
    await mockRouter.setExchangeRate(await tokenA.getAddress(), await tokenB.getAddress(), rateAtoB);
    await mockRouter.setExchangeRate(await tokenB.getAddress(), await tokenA.getAddress(), rateBtoA);
    
    // Deploy PSYMM contract
    const psymmFactory = await ethers.getContractFactory("PSYMM");
    const psymm = await psymmFactory.deploy();
    
    // Deploy UniswapV3SMAFactory
    const factoryFactory = await ethers.getContractFactory("UniswapV3SMAFactory");
    const uniFactory = await factoryFactory.deploy(await psymm.getAddress(), await mockRouter.getAddress());
    
    // Setup allowed tokens and fees in factory
    await uniFactory.setTokenAllowed(await tokenA.getAddress(), true);
    await uniFactory.setTokenAllowed(await tokenB.getAddress(), true);
    await uniFactory.setFeeAllowed(3000, true); // 0.3% fee tier
    
    // Mint tokens to users
    const mintAmount = ethers.parseUnits("1000", 18);
    await tokenA.mint(owner.address, mintAmount);
    await tokenB.mint(owner.address, mintAmount);
    await tokenA.mint(user1.address, mintAmount);
    await tokenB.mint(user1.address, mintAmount);
    await tokenA.mint(user2.address, mintAmount);
    await tokenB.mint(user2.address, mintAmount);
    
    // Also mint to the mock router so it can "send" tokens during swaps
    await tokenA.mint(await mockRouter.getAddress(), mintAmount);
    await tokenB.mint(await mockRouter.getAddress(), mintAmount);
    
    return { 
      owner, user1, user2, 
      tokenA, tokenB, 
      psymm, mockRouter, uniFactory 
    };
  }

  describe("UniswapV3SMA Deployment", function () {
    it("Should deploy a UniswapV3SMA via the factory using PSYMM", async function () {
      const { psymm, uniFactory, tokenA, owner } = await loadFixture(deployUniswapFixture);
      
      const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
      const pSymmAddress = await psymm.getAddress();
      const uniFactoryAddress = await uniFactory.getAddress();
      const tokenAAddress = await tokenA.getAddress();
      
      const publicKey = {
        parity: 0,
        x: "0x2222222222222222222222222222222222222222222222222222222222222222" as `0x${string}`
      };
      
      const tempCustodyIdInternal = ethers.id("temp-custody-for-deploy-internal"); 
      const deployDataForSMA = ethers.solidityPacked(["bytes32"], [tempCustodyIdInternal]);

      const ppmHelper = new PPMHelper(Number(chainId), pSymmAddress as `0x${string}`);
      const deployActionIndex = ppmHelper.deploySMA(
        "uniswapV3",
        uniFactoryAddress as `0x${string}`,
        deployDataForSMA as `0x${string}`,
        0, 
        publicKey
      );
      const custodyIdForPSYMMLink = ppmHelper.getCustodyID(); 

      const depositAmount = ethers.parseUnits("1", 18);
      await tokenA.approve(pSymmAddress, depositAmount);
      await psymm.addressToCustody(custodyIdForPSYMMLink, tokenAAddress, depositAmount);

      const currentTimestamp = await time.latest();
      const deployTimestamp = currentTimestamp + 3600;
      const nullifier = "0x3333333333333333333333333333333333333333333333333333333333333333" as `0x${string}`;
      
      const verificationDataForDeploySMA = {
        id: custodyIdForPSYMMLink,
        state: 0,
        timestamp: deployTimestamp,
        pubKey: publicKey,
        sig: {
          e: nullifier,
          s: "0x4444444444444444444444444444444444444444444444444444444444444444" as `0x${string}`
        },
        merkleProof: ppmHelper.getMerkleProof(deployActionIndex)
      };

      await time.setNextBlockTimestamp(deployTimestamp);

      const tx = await psymm.deploySMA(
        "uniswapV3",
        uniFactoryAddress,
        deployDataForSMA,
        verificationDataForDeploySMA
      );
      const receipt = await tx.wait();
      
      const event = receipt?.logs.find(log => {
        try {
          return log.fragment && log.fragment.name === "SMADeployed";
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
      const smaAddress = event!.args.smaAddress;
      
      const uniswapSMAContract = await ethers.getContractAt("UniswapV3SMA", smaAddress);
      expect(await uniswapSMAContract.pSymm()).to.equal(pSymmAddress);
      expect(await uniswapSMAContract.custodyId()).to.equal(tempCustodyIdInternal);
      expect(await uniswapSMAContract.factory()).to.equal(uniFactoryAddress);
    });
  });

  describe("UniswapV3SMA Swaps", function () {
    it("Should execute an exactInputSingle swap", async function () {
      const { psymm, uniFactory, tokenA, tokenB, owner } = await loadFixture(deployUniswapFixture);
      
      const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
      const pSymmAddress = await psymm.getAddress();
      const uniFactoryAddress = await uniFactory.getAddress();
      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();

      const publicKey = {
        parity: 0,
        x: "0x2222222222222222222222222222222222222222222222222222222222222222" as `0x${string}`
      };
      
      const smaReturnsToCustodyId = ethers.id("sma-returns-funds-here"); 
      const deployDataForSMA = ethers.solidityPacked(["bytes32"], [smaReturnsToCustodyId]);
      
      // Pre-calculate the SMA address
      // The UniswapV3SMAFactory will deploy the SMA. Its nonce will be 0 for the first deployment.
      // However, PSYMM.deploySMA calls the factory. The factory is the actual deployer.
      // For simplicity in this test, we'll assume the factory's nonce before this specific psymm.deploySMA call is 0.
      // In a more complex scenario with multiple factory uses, this would need careful tracking.
      const factoryNonce = await ethers.provider.getTransactionCount(uniFactoryAddress);
      const expectedSmaAddress = ethers.getCreateAddress({ from: uniFactoryAddress, nonce: factoryNonce });

      const ppmHelper = new PPMHelper(Number(chainId), pSymmAddress as `0x${string}`);
      const swapAmount = ethers.parseUnits("10", 18);
      const functionSignature = "swapExactInputSingle(address,address,uint24,uint256)";
      const encodedData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "uint256"],
        [tokenAAddress, tokenBAddress, 3000, swapAmount]
      );
      
      // Create function selector (first 4 bytes of the hash of the function signature)
      const selector = ethers.id(functionSignature).slice(0, 10);
      
      // Remove the 0x prefix from encodedData before concatenating
      const swapCallData = selector + encodedData.slice(2) as `0x${string}`;

      console.log("deployActionIndex......");
      const deployActionIndex = ppmHelper.deploySMA(
        "uniswapV3",
        uniFactoryAddress as `0x${string}`,
        deployDataForSMA as `0x${string}`,
        0, 
        publicKey
      );
      const custodyToSMAIndex = ppmHelper.custodyToSMA(
        expectedSmaAddress as `0x${string}`, 
        tokenAAddress as `0x${string}`,
        0, 
        publicKey
      );
      const callSMAIndex = ppmHelper.callSMA(
          "uniswapV3",
        expectedSmaAddress as `0x${string}`, // Use pre-calculated address
        swapCallData as `0x${string}`,
        0, 
        publicKey
      );

      const thePpmRoot = ppmHelper.getCustodyID(); // This is the ID we'll use for PSYMM operations

      // Set up custody in PSYMM using thePpmRoot as the ID
      const setupAmount = ethers.parseUnits("1", 18);
      const totalAmountToFundCustody = setupAmount + swapAmount;
      

      console.log("approve......");
      await tokenA.approve(pSymmAddress, totalAmountToFundCustody);
      console.log("addressToCustody......");
      await psymm.addressToCustody(thePpmRoot, tokenAAddress, totalAmountToFundCustody);
      
      const initialTimestamp = await time.latest();
      const deployTimestamp = initialTimestamp + 3600;
      const deployNullifier = "0x3333333333333333333333333333333333333333333333333333333333333333" as `0x${string}`;
      
      const verificationDataForDeploySMA = {
        id: thePpmRoot, 
        state: 0,
        timestamp: deployTimestamp,
        pubKey: publicKey, 
        sig: {
          e: deployNullifier,
          s: "0x4444444444444444444444444444444444444444444444444444444444444444" as `0x${string}`
        }, 
        merkleProof: ppmHelper.getMerkleProof(deployActionIndex) 
      };
      
      await time.setNextBlockTimestamp(deployTimestamp);
      // PPMs[thePpmRoot] IS thePpmRoot (due to addressToCustody).
      console.log("deploySMA......");
      const deployTx = await psymm.deploySMA(
        "uniswapV3", 
        uniFactoryAddress, 
        deployDataForSMA, 
        verificationDataForDeploySMA
      );
      const deployReceipt = await deployTx.wait();
      console.log("deployReceipt......");
      const deployEvent = deployReceipt?.logs.find(log => {
        try {
          return log.fragment && log.fragment.name === "SMADeployed";
        } catch {
          return false;
        }
      });
      expect(deployEvent).to.not.be.undefined;
      const smaAddress = deployEvent!.args.smaAddress;
      expect(smaAddress).to.equal(expectedSmaAddress, "Deployed SMA address should match pre-calculated address");
            
      const custodyToSMATimestamp = await time.latest() + 3700;
      const custodyToSMANullifier = "0x5555555555555555555555555555555555555555555555555555555555555555" as `0x${string}`;
      
      const verificationDataForCustodyToSMA = {
        id: thePpmRoot, 
        state: 0, 
        timestamp: custodyToSMATimestamp,
        pubKey: publicKey, 
        sig: {
          e: custodyToSMANullifier,
          s: "0x6666666666666666666666666666666666666666666666666666666666666666" as `0x${string}`
        }, 
        merkleProof: ppmHelper.getMerkleProof(custodyToSMAIndex) 
      };
      
      console.log("custodyToSMA......");
      await time.setNextBlockTimestamp(custodyToSMATimestamp);
      await psymm.custodyToSMA(tokenAAddress, smaAddress, swapAmount, verificationDataForCustodyToSMA);
      console.log("custodyToSMA done......");
      expect(await tokenA.balanceOf(smaAddress)).to.equal(swapAmount);
      
      const callSMATimestamp = await time.latest() + 3800;
      const callSMANullifier = "0x7777777777777777777777777777777777777777777777777777777777777777" as `0x${string}`;
      
      const verificationDataForCallSMA = {
        id: thePpmRoot, 
        state: 0, 
        timestamp: callSMATimestamp,
        pubKey: publicKey, 
        sig: {
          e: callSMANullifier,
          s: "0x8888888888888888888888888888888888888888888888888888888888888888" as `0x${string}`
        }, 
        merkleProof: ppmHelper.getMerkleProof(callSMAIndex) 
      };
      console.log("callSMA......");
      await time.setNextBlockTimestamp(callSMATimestamp);
      await psymm.callSMA("uniswapV3", smaAddress, swapCallData, "0x", verificationDataForCallSMA);
      console.log("callSMA done......");
      expect(await tokenA.balanceOf(smaAddress)).to.equal(0);
      expect(await tokenB.balanceOf(smaAddress)).to.equal(0);
      
      const finalCustodyBalanceB = await psymm.custodyBalances(smaReturnsToCustodyId, tokenBAddress);
      expect(finalCustodyBalanceB).to.be.gt(0);
      
      const expectedAmountB = (swapAmount * BigInt(2) * BigInt(997)) / BigInt(1000); 
      const tolerancePercentage = 0.001; 
      const toleranceBigInt = expectedAmountB * BigInt(Math.floor(tolerancePercentage * 10000)) / BigInt(10000);
      const lowerBound = expectedAmountB - toleranceBigInt;
      const upperBound = expectedAmountB + toleranceBigInt;
      expect(finalCustodyBalanceB).to.be.within(lowerBound, upperBound);
    });
  });
}); 