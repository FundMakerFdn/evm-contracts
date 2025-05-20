import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { PPMHelper } from './utils/PPMHelper';
import { SchnorrHelper } from './utils/schnorrHelper';
import { ethers } from 'hardhat';
import { EventLog, hexlify, randomBytes } from 'ethers';
import hre from 'hardhat';
import { MockERC20 } from '../typechain-types';

describe('UniswapV3SMA', function () {
  // We define a fixture to reuse the same setup in every test
  async function deployUniswapFixture() {
    // Get signers
    const [owner, user1, user2] = await ethers.getSigners();

    const LinkToken = await hre.ethers.getContractFactory('MockERC20');
    const linkToken = (await LinkToken.deploy(
      'Chainlink Token',
      'LINK',
      18
    )) as unknown as MockERC20;

    // Deploy mock tokens
    const mockTokenFactory = await ethers.getContractFactory('MockERC20');
    const tokenA = await mockTokenFactory.deploy('Token A', 'TKNA', 18);
    const tokenB = await mockTokenFactory.deploy('Token B', 'TKNB', 18);

    // Deploy mock Uniswap V3 Router
    const mockRouterFactory = await ethers.getContractFactory(
      'MockUniswapV3Router'
    );
    const mockRouter = await mockRouterFactory.deploy();

    // Set exchange rates in the mock
    const rateAtoB = ethers.parseUnits('2', 18); // 1 Token A = 2 Token B
    const rateBtoA = ethers.parseUnits('0.5', 18); // 1 Token B = 0.5 Token A
    await mockRouter.setExchangeRate(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      rateAtoB
    );
    await mockRouter.setExchangeRate(
      await tokenB.getAddress(),
      await tokenA.getAddress(),
      rateBtoA
    );

    // Deploy PSYMM contract
    const psymmFactory = await ethers.getContractFactory('PSYMM');
    const psymm = await psymmFactory.deploy();

    // Deploy UniswapV3SMAFactory
    const factoryFactory = await ethers.getContractFactory(
      'UniswapV3SMAFactory'
    );
    const uniFactory = await factoryFactory.deploy(
      await psymm.getAddress(),
      await mockRouter.getAddress()
    );

    // Setup allowed tokens and fees in factory
    await uniFactory.setTokenAllowed(await tokenA.getAddress(), true);
    await uniFactory.setTokenAllowed(await tokenB.getAddress(), true);
    await uniFactory.setFeeAllowed(3000, true); // 0.3% fee tier

    // Mint tokens to users
    const mintAmount = ethers.parseUnits('1000', 18);
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
      owner,
      user1,
      user2,
      tokenA,
      tokenB,
      psymm,
      mockRouter,
      uniFactory,
      linkToken,
    };
  }

  describe('UniswapV3SMA Deployment', function () {
    it('Should deploy a UniswapV3SMA via the factory using PSYMM', async function () {
      const { psymm, uniFactory, tokenA, owner, linkToken } = await loadFixture(
        deployUniswapFixture
      );

      const chainId = await hre.ethers.provider
        .getNetwork()
        .then((n) => Number(n.chainId));
      const publicKey = {
        parity: 0,
        x: hexlify(randomBytes(32)) as `0x${string}`,
      };
      const pSymmAddress = await psymm.getAddress();
      const uniFactoryAddress = await uniFactory.getAddress();
      const tokenAAddress = await tokenA.getAddress();

      const psymmAddress = (await psymm.getAddress()) as `0x${string}`;
      const ppmHelper = new PPMHelper(chainId, psymmAddress);

      // Add deploy action to PPMHelper first
      const deployDataForSMA = '0x' as `0x${string}`;
      const deployActionIndex = ppmHelper.deploySMA(
        'UniswapV3SMA',
        (await uniFactoryAddress) as `0x${string}`,
        deployDataForSMA,
        0,
        publicKey
      );

      // Get custody ID after adding the action
      const custodyId = ppmHelper.getCustodyID();

      // Setup custody with LINK tokens
      const depositAmount = hre.ethers.parseEther('1');
      await linkToken.mint(owner.address, depositAmount);
      await linkToken.approve(psymmAddress, depositAmount);
      await psymm.addressToCustody(
        custodyId,
        await linkToken.getAddress(),
        depositAmount
      );

      // Setup verification data
      const currentTimestamp = await time.latest();
      const deployTimestamp = currentTimestamp + 3600;
      const nullifier = hexlify(randomBytes(32)) as `0x${string}`;

      const verificationData = {
        id: custodyId,
        state: 0,
        timestamp: deployTimestamp,
        pubKey: publicKey,
        sig: {
          e: nullifier,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(deployActionIndex),
      };

      await time.setNextBlockTimestamp(deployTimestamp);

      // Deploy UniswapV3SMA through PSYMM using custody ID directly
      const tx = await psymm.deploySMA(
        'UniswapV3SMA',
        (await uniFactory.getAddress()) as `0x${string}`,
        deployDataForSMA,
        verificationData
      );

      const receipt = await tx.wait();

      const event = receipt?.logs.find((log) => {
        const eventLog = log as EventLog;
        return eventLog.eventName === 'SMADeployed';
      }) as EventLog;

      expect(event).to.not.be.undefined;
      const smaAddress = event!.args.smaAddress;

      const uniswapSMAContract = await ethers.getContractAt(
        'UniswapV3SMA',
        smaAddress
      );
      expect(await uniswapSMAContract.pSymm()).to.equal(pSymmAddress);
      expect(await uniswapSMAContract.custodyId()).to.equal(custodyId);
      expect(await uniswapSMAContract.factory()).to.equal(uniFactoryAddress);
    });
  });

  describe('UniswapV3SMA Swaps', function () {
    it('Should execute an exactInputSingle swap', async function () {
      const { psymm, uniFactory, tokenA, tokenB, owner } = await loadFixture(
        deployUniswapFixture
      );

      const chainId = await ethers.provider.getNetwork().then((n) => n.chainId);
      const pSymmAddress = await psymm.getAddress();
      const uniFactoryAddress = await uniFactory.getAddress();
      const tokenAAddress = await tokenA.getAddress();
      const tokenBAddress = await tokenB.getAddress();

      const publicKey = {
        parity: 0,
        x: hexlify(randomBytes(32)) as `0x${string}`,
      };

      const deployDataForSMA = '0x' as `0x${string}`;

      // Pre-calculate the SMA address
      // The UniswapV3SMAFactory will deploy the SMA. Its nonce will be 0 for the first deployment.
      // However, PSYMM.deploySMA calls the factory. The factory is the actual deployer.
      // For simplicity in this test, we'll assume the factory's nonce before this specific psymm.deploySMA call is 0.
      // In a more complex scenario with multiple factory uses, this would need careful tracking.
      const factoryNonce = await ethers.provider.getTransactionCount(
        uniFactoryAddress
      );
      const expectedSmaAddress = ethers.getCreateAddress({
        from: uniFactoryAddress,
        nonce: factoryNonce,
      });

      const ppmHelper = new PPMHelper(
        Number(chainId),
        pSymmAddress as `0x${string}`
      );
      const swapAmount = ethers.parseUnits('10', 18);
      const functionSignature =
        'swapExactInputSingle(address,address,uint24,uint256)';
      const encodedData = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'address', 'uint24', 'uint256'],
        [tokenAAddress, tokenBAddress, 3000, swapAmount]
      );

      // Create function selector (first 4 bytes of the hash of the function signature)
      const selector = ethers.id(functionSignature).slice(0, 10);

      // Remove the 0x prefix from encodedData before concatenating
      const swapCallData = (selector + encodedData.slice(2)) as `0x${string}`;

      const deployActionIndex = ppmHelper.deploySMA(
        'UniswapV3SMA',
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
        'UniswapV3SMA',
        expectedSmaAddress as `0x${string}`, // Use pre-calculated address
        swapCallData as `0x${string}`,
        0,
        publicKey
      );

      const thePpmRoot = ppmHelper.getCustodyID(); // This is the ID we'll use for PSYMM operations

      // Set up custody in PSYMM using thePpmRoot as the ID
      const setupAmount = ethers.parseUnits('1', 18);
      const totalAmountToFundCustody = setupAmount + swapAmount;

      await tokenA.approve(pSymmAddress, totalAmountToFundCustody);
      await psymm.addressToCustody(
        thePpmRoot,
        tokenAAddress,
        totalAmountToFundCustody
      );

      const initialTimestamp = await time.latest();
      const deployTimestamp = initialTimestamp + 3600;
      const deployNullifier = hexlify(randomBytes(32)) as `0x${string}`;

      const verificationDataForDeploySMA = {
        id: thePpmRoot,
        state: 0,
        timestamp: deployTimestamp,
        pubKey: publicKey,
        sig: {
          e: deployNullifier,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(deployActionIndex),
      };

      // call Test verification contract before calling ccipReceive on the destination receiver
      const testVerification = await ethers.getContractAt(
        'TestVerification',
        '0x0000000000000000000000000000000000000000'
      );
      const item = ppmHelper.getPPM()[deployActionIndex];
      const party = Array.isArray(item.party) ? item.party[0] : item.party;
      await expect(
        testVerification.verifyLeaf(
          verificationDataForDeploySMA.id,
          verificationDataForDeploySMA.merkleProof,
          'deploySMA',
          chainId,
          await psymm.getAddress(),
          verificationDataForDeploySMA.state,
          item.args,
          party.parity,
          party.x
        )
      ).to.not.be.reverted;

      await time.setNextBlockTimestamp(deployTimestamp);
      // PPMs[thePpmRoot] IS thePpmRoot (due to addressToCustody).
      const deployTx = await psymm.deploySMA(
        'UniswapV3SMA',
        uniFactoryAddress,
        deployDataForSMA,
        verificationDataForDeploySMA
      );
      const deployReceipt = await deployTx.wait();
      const deployEvent = deployReceipt?.logs.find((log) => {
        try {
          return log.fragment && log.fragment.name === 'SMADeployed';
        } catch {
          return false;
        }
      });
      expect(deployEvent).to.not.be.undefined;
      const smaAddress = deployEvent!.args.smaAddress;
      expect(smaAddress).to.equal(
        expectedSmaAddress,
        'Deployed SMA address should match pre-calculated address'
      );

      const custodyToSMATimestamp = (await time.latest()) + 3700;
      const custodyToSMANullifier = hexlify(randomBytes(32)) as `0x${string}`;

      const verificationDataForCustodyToSMA = {
        id: thePpmRoot,
        state: 0,
        timestamp: custodyToSMATimestamp,
        pubKey: publicKey,
        sig: {
          e: custodyToSMANullifier,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(custodyToSMAIndex),
      };

      await time.setNextBlockTimestamp(custodyToSMATimestamp);
      await psymm.custodyToSMA(
        tokenAAddress,
        smaAddress,
        swapAmount,
        verificationDataForCustodyToSMA
      );
      expect(await tokenA.balanceOf(smaAddress)).to.equal(swapAmount);

      const callSMATimestamp = (await time.latest()) + 3800;
      const callSMANullifier = hexlify(randomBytes(32)) as `0x${string}`;

      const verificationDataForCallSMA = {
        id: thePpmRoot,
        state: 0,
        timestamp: callSMATimestamp,
        pubKey: publicKey,
        sig: {
          e: callSMANullifier,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(callSMAIndex),
      };
      await time.setNextBlockTimestamp(callSMATimestamp);
      await psymm.callSMA(
        'UniswapV3SMA',
        smaAddress,
        swapCallData,
        deployDataForSMA,
        verificationDataForCallSMA
      );
      expect(await tokenA.balanceOf(smaAddress)).to.equal(0);
      expect(await tokenB.balanceOf(smaAddress)).to.equal(0);

      const finalCustodyBalanceB = await psymm.custodyBalances(
        thePpmRoot,
        tokenBAddress
      );
      expect(finalCustodyBalanceB).to.be.gt(0);

      const expectedAmountB =
        (swapAmount * BigInt(2) * BigInt(997)) / BigInt(1000);
      const tolerancePercentage = 0.001;
      const toleranceBigInt =
        (expectedAmountB * BigInt(Math.floor(tolerancePercentage * 10000))) /
        BigInt(10000);
      const lowerBound = expectedAmountB - toleranceBigInt;
      const upperBound = expectedAmountB + toleranceBigInt;
      expect(finalCustodyBalanceB).to.be.within(lowerBound, upperBound);
    });
  });
});
