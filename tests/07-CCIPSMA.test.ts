import { expect } from 'chai';
import hre from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import {
  CCIP,
  CCIPReceiver,
  CCIPSMAFactory,
  CCIPSMA,
  PSYMM,
  MockCCIPRouter,
  MockERC20,
} from '../typechain-types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { MaxUint256, EventLog, Log, hexlify, randomBytes } from 'ethers';
import '@nomicfoundation/hardhat-chai-matchers';
import { PPMHelper } from './utils/PPMHelper';

describe('CCIPSMA Integration Tests', function () {
  // Constants
  const CHAIN_SELECTOR_SOURCE = 1n;
  const CHAIN_SELECTOR_DEST = 2n;
  const MOCK_FEE = hre.ethers.parseEther('0.1');
  const MOCK_MESSAGE_ID = hre.ethers.keccak256(
    hre.ethers.toUtf8Bytes('mock-message-id')
  );

  // Test fixture setup
  async function deployFixture() {
    const [owner, user1, user2] = await hre.ethers.getSigners();

    // Deploy LINK token for fees
    const LinkToken = await hre.ethers.getContractFactory('MockERC20');
    const linkToken = (await LinkToken.deploy(
      'Chainlink Token',
      'LINK',
      18
    )) as unknown as MockERC20;

    // Deploy Mock CCIP Router
    const RouterFactory = await hre.ethers.getContractFactory('MockCCIPRouter');
    const router = (await RouterFactory.deploy()) as unknown as MockCCIPRouter;
    await router.setFee(MOCK_FEE);
    await router.setMessageId(MOCK_MESSAGE_ID);

    // Deploy CCIP contracts for source chain
    const CCIPFactory = await hre.ethers.getContractFactory('CCIP');
    const ccipSource = (await CCIPFactory.deploy(
      await router.getAddress()
    )) as unknown as CCIP;

    const CCIPReceiverFactory = await hre.ethers.getContractFactory(
      'CCIPReceiver'
    );
    const ccipReceiverSource = (await CCIPReceiverFactory.deploy(
      await router.getAddress()
    )) as unknown as CCIPReceiver;

    // Deploy CCIP contracts for destination chain
    const ccipDest = (await CCIPFactory.deploy(
      await router.getAddress()
    )) as unknown as CCIP;
    const ccipReceiverDest = (await CCIPReceiverFactory.deploy(
      await router.getAddress()
    )) as unknown as CCIPReceiver;

    // Deploy PSYMM with proper typing
    const PSYMMFactory = await hre.ethers.getContractFactory('PSYMM');
    const psymm = (await PSYMMFactory.deploy()) as unknown as PSYMM;

    // Deploy CCIPSMAFactory for both chains
    const FactoryFactory = await hre.ethers.getContractFactory(
      'CCIPSMAFactory'
    );
    const factorySource = (await FactoryFactory.deploy(
      await psymm.getAddress(),
      await ccipSource.getAddress(),
      await ccipReceiverSource.getAddress()
    )) as unknown as CCIPSMAFactory;

    // Setup CCIP configurations
    await ccipSource.setDestinationCCIPReceiver(
      CHAIN_SELECTOR_DEST,
      await ccipReceiverDest.getAddress()
    );

    // Setup cross-chain permissions
    await ccipReceiverSource.setSourceSenderWhitelist(
      CHAIN_SELECTOR_DEST,
      await ccipDest.getAddress(),
      true
    );

    // Setup destination chains in factories
    await factorySource.setDestinationChain(CHAIN_SELECTOR_DEST, true);

    // Mint LINK tokens for fees and approve PSYMM
    const initialBalance = hre.ethers.parseEther('1000');
    await linkToken.mint(owner.address, initialBalance);

    // Deploy CCIPSMA on source and destination chains through PSYMM

    return {
      owner,
      user1,
      user2,
      linkToken,
      router,
      psymm,
      ccipSource,
      ccipDest,
      ccipReceiverSource,
      ccipReceiverDest,
      factorySource,
      custodyId: hre.ethers.keccak256(hre.ethers.toUtf8Bytes('test-custody')),
    };
  }

  describe('Deployment', function () {
    it('should fail when trying to deploy directly through factory', async function () {
      const { factorySource, user1 } = await loadFixture(deployFixture);

      // Create a test custody ID
      const testCustodyId = hre.ethers.id('test-direct-deploy');

      // Attempt to deploy directly through factory
      const deployData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32'],
        [testCustodyId]
      );

      // Should fail because only PSYMM can deploy SMAs
      await expect(factorySource.deploySMA(deployData)).to.be.revertedWith(
        'Factory: Only pSymm can deploy SMAs'
      );
    });

    it('should deploy CCIPSMA through PSYMM with correct initialization', async function () {
      const {
        psymm,
        factorySource,
        ccipSource,
        ccipReceiverSource,
        linkToken,
        owner,
      } = await loadFixture(deployFixture);

      const chainId = await hre.ethers.provider
        .getNetwork()
        .then((n) => n.chainId);
      const pSymmAddress = await psymm.getAddress();
      const factoryAddress = await factorySource.getAddress();
      const linkTokenAddress = await linkToken.getAddress();

      // Setup public key for PPM
      const publicKey = {
        parity: 0,
        x: '0x2222222222222222222222222222222222222222222222222222222222222222' as `0x${string}`,
      };

      // Create custody ID and deployment data
      const tempCustodyIdInternal = hre.ethers.id('temp-custody-for-ccipsma');
      const deployDataForSMA = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32'],
        [tempCustodyIdInternal]
      );

      // Setup PPM Helper
      const ppmHelper = new PPMHelper(
        Number(chainId),
        pSymmAddress as `0x${string}`
      );
      const deployActionIndex = ppmHelper.deploySMA(
        'CCIPSMA',
        factoryAddress as `0x${string}`,
        deployDataForSMA as `0x${string}`,
        0,
        publicKey
      );
      const custodyIdForPSYMMLink = ppmHelper.getCustodyID();

      // Setup custody with LINK tokens
      const depositAmount = hre.ethers.parseEther('1');
      await linkToken.mint(owner.address, depositAmount);
      await linkToken.approve(pSymmAddress, depositAmount);
      await psymm
        .connect(owner)
        .addressToCustody(
          custodyIdForPSYMMLink,
          linkTokenAddress,
          depositAmount
        );

      // Setup verification data
      const currentTimestamp = await time.latest();
      const deployTimestamp = currentTimestamp + 3600;
      const nullifier =
        '0x3333333333333333333333333333333333333333333333333333333333333333' as `0x${string}`;

      const verificationData = {
        id: custodyIdForPSYMMLink,
        state: 0,
        timestamp: deployTimestamp,
        pubKey: publicKey,
        sig: {
          e: nullifier,
          s: '0x4444444444444444444444444444444444444444444444444444444444444444' as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(deployActionIndex),
      };

      await time.setNextBlockTimestamp(deployTimestamp);

      // Deploy CCIPSMA through PSYMM
      const tx = await psymm.deploySMA(
        'CCIPSMA',
        factoryAddress,
        deployDataForSMA,
        verificationData
      );
      const receipt = await tx.wait();

      // Find deployment event
      const event = receipt?.logs.find((log) => {
        const eventLog = log as EventLog;
        return eventLog.eventName === 'SMADeployed';
      }) as EventLog;

      expect(event).to.not.be.undefined;
      const smaAddress = event.args[2]; // third argument is smaAddress

      // Verify CCIPSMA initialization
      const ccipSMA = await hre.ethers.getContractAt('CCIPSMA', smaAddress);
      expect(await ccipSMA.pSymm()).to.equal(pSymmAddress);
      expect(await ccipSMA.ccipContract()).to.equal(
        await ccipSource.getAddress()
      );
      expect(await ccipSMA.localCCIPReceiver()).to.equal(
        await ccipReceiverSource.getAddress()
      );
      expect(await ccipSMA.factory()).to.equal(factoryAddress);
      expect(await ccipSMA.custodyId()).to.equal(tempCustodyIdInternal);
    });

    it('should emit PPMUpdated event when updating PPM through PSYMM', async function () {
      const { psymm, owner } = await loadFixture(deployFixture);

      // Setup PPM Helper
      const chainId = await hre.ethers.provider
        .getNetwork()
        .then((n) => Number(n.chainId));
      const psymmAddress = (await psymm.getAddress()) as `0x${string}`;
      const ppmHelper = new PPMHelper(chainId, psymmAddress);

      // Setup public key for PPM verification
      const publicKey = {
        parity: 0,
        x: '0x2222222222222222222222222222222222222222222222222222222222222222' as `0x${string}`,
      };

      // Add updatePPM action to PPMHelper and get custody ID
      const updateActionIndex = ppmHelper.updatePPM(0, publicKey);
      const custodyId = ppmHelper.getCustodyID();

      // Setup initial custody state with LINK tokens
      const LinkToken = await hre.ethers.getContractFactory('MockERC20');
      const linkToken = (await LinkToken.deploy(
        'Chainlink Token',
        'LINK',
        18
      )) as unknown as MockERC20;
      const depositAmount = hre.ethers.parseEther('1');
      await linkToken.mint(owner.address, depositAmount);
      await linkToken.approve(psymmAddress, depositAmount);
      await psymm.addressToCustody(
        custodyId,
        await linkToken.getAddress(),
        depositAmount
      );

      // Setup verification data for PPM update
      const currentTimestamp = await time.latest();
      const updateTimestamp = currentTimestamp + 3600;
      const newPPM = hre.ethers.id('new-ppm-value');

      const verificationData = {
        id: custodyId,
        state: 0,
        timestamp: updateTimestamp,
        pubKey: publicKey,
        sig: {
          e: '0x3333333333333333333333333333333333333333333333333333333333333333' as `0x${string}`,
          s: '0x4444444444444444444444444444444444444444444444444444444444444444' as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(updateActionIndex),
      };

      // Set block timestamp for verification
      await time.setNextBlockTimestamp(updateTimestamp);

      // Verify PPM update and event emission
      await expect(psymm.updatePPM(newPPM, verificationData))
        .to.emit(psymm, 'PPMUpdated')
        .withArgs(custodyId, newPPM, updateTimestamp);

      // Verify the PPM was actually updated
      expect(await psymm.getPPM(custodyId)).to.equal(newPPM);
    });

    it('should update PPM through PSYMM', async function () {
      const { psymm, owner, linkToken } = await loadFixture(deployFixture);

      // Get chain ID and PSYMM address
      const chainId = await hre.ethers.provider
        .getNetwork()
        .then((n) => Number(n.chainId));
      const psymmAddress = (await psymm.getAddress()) as `0x${string}`;

      // Setup PPMHelper and public key
      const ppmHelper = new PPMHelper(chainId, psymmAddress);
      const publicKey = {
        parity: 0,
        x: hexlify(randomBytes(32)) as `0x${string}`,
      };

      // Add PPM update action and get custody ID
      const updateActionIndex = ppmHelper.updatePPM(0, publicKey);
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

      // Setup PPM update data
      const currentTimestamp = await time.latest();
      const updateTimestamp = currentTimestamp + 3600;
      const newPPM = hre.ethers.id('new-ppm-value');

      const verificationData = {
        id: custodyId,
        state: 0,
        timestamp: updateTimestamp,
        pubKey: publicKey,
        sig: {
          e: hexlify(randomBytes(32)) as `0x${string}`,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(updateActionIndex),
      };

      // Update PPM
      await time.setNextBlockTimestamp(updateTimestamp);
      const tx = await psymm.updatePPM(newPPM, verificationData);
      const receipt = await tx.wait();

      // Verify PPM update event
      const ppmEvent = receipt?.logs.find(
        (log) => (log as EventLog).eventName === 'PPMUpdated'
      ) as EventLog;
      expect(ppmEvent).to.not.be.undefined;
      expect(ppmEvent.args[1]).to.equal(newPPM);

      // Verify PPM was updated
      expect(await psymm.getPPM(custodyId)).to.equal(newPPM);
    });

    // TODO: Add tests for validation of updatePPM on source and destination chains
    // TODO: Add tests for sending updatePPM through CCIPSMA to CCIP
    // TODO: Add tests for receiving updatePPM through CCIP to CCIPReceiver on destination chain
  });
});
