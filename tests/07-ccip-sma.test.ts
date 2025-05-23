import { expect } from 'chai';
import hre, { ethers } from 'hardhat';
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
import {
  MaxUint256,
  EventLog,
  Log,
  hexlify,
  randomBytes,
  parseEther,
} from 'ethers';
import '@nomicfoundation/hardhat-chai-matchers';
import { PPMHelper, SMAType } from './utils/PPMHelper';

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

    // Deploy TestVerification contract
    const TestVerificationFactory = await hre.ethers.getContractFactory(
      'TestVerification'
    );
    const testVerification = await TestVerificationFactory.deploy();
    await testVerification.waitForDeployment();

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
      testVerification,
      custodyId: hre.ethers.keccak256(hre.ethers.toUtf8Bytes('test-custody')),
    };
  }

  async function deployCCIPSMA() {
    const {
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
      testVerification,
    } = await loadFixture(deployFixture);

    const chainId = await hre.ethers.provider
      .getNetwork()
      .then((n) => Number(n.chainId));
    const publicKey = {
      parity: 0,
      x: hexlify(randomBytes(32)) as `0x${string}`,
    };

    const psymmAddress = (await psymm.getAddress()) as `0x${string}`;
    const ppmHelper = new PPMHelper(chainId, psymmAddress);

    // Add deploy action to PPMHelper first
    const deployDataForSMA = '0x' as `0x${string}`;
    const deployActionIndex = ppmHelper.deploySMA(
      SMAType.CCIP,
      (await factorySource.getAddress()) as `0x${string}`,
      deployDataForSMA,
      0,
      publicKey
    );

    // Add PPM update action and get custody ID
    const updateActionIndex = ppmHelper.updatePPM(0, publicKey);

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

    // Deploy CCIPSMA through PSYMM using custody ID directly
    const tx = await psymm.deploySMA(
      SMAType.CCIP,
      (await factorySource.getAddress()) as `0x${string}`,
      deployDataForSMA,
      verificationData
    );

    const receipt = await tx.wait();

    const event = receipt?.logs.find((log) => {
      const eventLog = log as EventLog;
      return eventLog.eventName === 'SMADeployed';
    }) as EventLog;

    const smaAddress = event.args[2]; // third argument is smaAddress
    const ccipSMASource = await hre.ethers.getContractAt('CCIPSMA', smaAddress);

    // Deploy destination CCIPSMA
    const CCIPSMAFactory = await hre.ethers.getContractFactory('CCIPSMA');
    const ccipSMADest = await CCIPSMAFactory.deploy(
      await psymm.getAddress(),
      await ccipDest.getAddress(),
      await ccipReceiverDest.getAddress(),
      await factorySource.getAddress(),
      custodyId,
      owner.address
    );
    await ccipSMADest.waitForDeployment();

    // Whitelist the owner for CCIPSMA
    await ccipSMASource.setWhitelistedCaller(owner.address, true);
    await ccipSMADest.setWhitelistedCaller(owner.address, true);

    // Whitelist the owner for CCIP
    await ccipSource.setCallerWhitelist(owner.address, true);
    await ccipDest.setCallerWhitelist(owner.address, true);

    // Whitelist CCISMA for CCIP
    await ccipSource.setCallerWhitelist(smaAddress, true);

    // Whitelist CCIPReceiver for CCIP
    await ccipSource.setCallerWhitelist(
      await ccipReceiverSource.getAddress(),
      true
    );

    // Whitelist CCIPReceiver on Destination for CCIP Source
    await ccipDest.setCallerWhitelist(
      await ccipReceiverDest.getAddress(),
      true
    );

    // Whitelist CCIP Source on Destination for CCIPReceiver Destination
    await ccipReceiverDest.setSourceSenderWhitelist(
      CHAIN_SELECTOR_SOURCE,
      await ccipSource.getAddress(),
      true
    );

    // Whitelist CCIPReceiver Destination on Source for CCIP
    await ccipReceiverDest.setLocalDestinationWhitelist(
      await ccipSMADest.getAddress(),
      true
    );

    return {
      smaAddress,
      custodyId,
      ccipSMASource,
      ccipSource,
      ccipReceiverSource,
      ccipDest,
      ccipReceiverDest,
      ccipSMADest,
      user1,
      user2,
      linkToken,
      router,
      psymm,
      factorySource,
      owner,
      ppmHelper,
      publicKey,
      testVerification,
      chainId,
    };
  }

  describe('CCIPSMA Deployment', () => {
    it('should fail when trying to deploy directly through factory', async function () {
      const { factorySource, user1, owner } = await loadFixture(deployFixture);

      // Create a test custody ID
      const testCustodyId = hre.ethers.id('test-direct-deploy');

      // Attempt to deploy directly through factory
      const deployData = hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32'],
        [testCustodyId]
      );

      // Should fail because only PSYMM can deploy SMAs
      await expect(
        factorySource.deploySMA(deployData, deployData, owner.address)
      ).to.be.revertedWith('CCIPSMAFactory: Only pSymm can deploy SMAs');
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
        x: hexlify(randomBytes(32)) as `0x${string}`,
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
        SMAType.CCIP,
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
      const nullifier = hexlify(randomBytes(32)) as `0x${string}`;

      const verificationData = {
        id: custodyIdForPSYMMLink,
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

      // Deploy CCIPSMA through PSYMM
      const tx = await psymm.deploySMA(
        SMAType.CCIP,
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
      expect(await ccipSMA.custodyId()).to.equal(custodyIdForPSYMMLink);
    });

    // deploy and whitelist CCSMA
    it('should deploy and whitelist CCSMA', async function () {
      const {
        psymm,
        owner,
        factorySource,
        linkToken,
        ppmHelper,
        chainId,
        publicKey,
        ccipSMASource,
      } = await loadFixture(deployCCIPSMA);

      // Prepare verification data for updatePPM
      const oldCustodyId = await ppmHelper.getCustodyID();
      const currentTimestamp = await time.latest();
      const updatePPMTimestamp = currentTimestamp + 3600;
      const nullifier = hexlify(randomBytes(32)) as `0x${string}`;

      const updatePPMVerificationData = {
        id: oldCustodyId,
        state: 0,
        timestamp: updatePPMTimestamp,
        pubKey: publicKey,
        sig: {
          e: nullifier,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(1),
      };

      await time.setNextBlockTimestamp(updatePPMTimestamp);

      // SMA already deployed
      const smaAddress = (await ccipSMASource.getAddress()) as `0x${string}`;
      const whitelistSMAIndex = ppmHelper.whitelistSMA(
        SMAType.CCIP,
        smaAddress,
        0,
        publicKey
      );

      // update PPM on psymm
      const smaCustodyId = ppmHelper.getCustodyID();
      await psymm.updatePPM(smaCustodyId, updatePPMVerificationData);

      // Prepare verification data for whitelistSMA
      const whitelistSMATimestamp = updatePPMTimestamp + 3600;
      const whitelistSMANullifier = hexlify(randomBytes(32)) as `0x${string}`;

      const whitelistSMAVerificationData = {
        id: oldCustodyId,
        state: 0,
        timestamp: whitelistSMATimestamp,
        pubKey: publicKey,
        sig: {
          e: whitelistSMANullifier,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(whitelistSMAIndex),
      };

      await time.setNextBlockTimestamp(whitelistSMATimestamp);

      // whitelist sma on psymm
      const tx = await psymm.whitelistSMA(
        SMAType.CCIP,
        smaAddress,
        whitelistSMAVerificationData
      );
      const receipt = await tx.wait();

      // Find whitelist event
      const event = receipt?.logs.find((log) => {
        const eventLog = log as EventLog;
        return eventLog.eventName === 'SMAWhitelisted';
      }) as EventLog;

      expect(event).to.not.be.undefined;
    });
  });

  describe('CCIPSMA PPM Update', () => {
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
        x: hexlify(randomBytes(32)) as `0x${string}`,
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
          e: hexlify(randomBytes(32)) as `0x${string}`,
          s: hexlify(randomBytes(32)) as `0x${string}`,
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
  });

  describe('CCIPSMA End-to-End Cross-Chain Flow', () => {
    it('should complete cross-chain flow from CCIPSMA to CCIPReceiver via CCIP and verify PPM update on destination PSYMM', async function () {
      const {
        psymm,
        owner,
        linkToken,
        ccipSource,
        ccipSMASource,
        ccipDest,
        ccipReceiverDest,
        ccipSMADest,
        router,
        ppmHelper,
        publicKey,
        testVerification,
        chainId,
        custodyId,
      } = await loadFixture(deployCCIPSMA);

      // Setup verification data for PPM update
      const currentTimestamp = await time.latest();
      const updateTimestamp = currentTimestamp + 3600;

      const updateVerificationData = {
        id: custodyId,
        state: 0,
        timestamp: updateTimestamp,
        pubKey: publicKey,
        sig: {
          e: hexlify(randomBytes(32)) as `0x${string}`,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(1),
      };

      // Update PPM
      await time.setNextBlockTimestamp(updateTimestamp);
      const updateTx = await psymm.updatePPM(custodyId, updateVerificationData);
      const updateReceipt = await updateTx.wait();

      // Verify PPM update event
      const ppmEvent = updateReceipt?.logs.find(
        (log) => (log as EventLog).eventName === 'PPMUpdated'
      ) as EventLog;
      expect(ppmEvent).to.not.be.undefined;
      expect(ppmEvent.args[1]).to.equal(custodyId);

      // Verify PPM was updated
      expect(await psymm.getPPM(custodyId)).to.equal(custodyId);

      // Transfer LINK tokens to CCIPSMA for fees
      await linkToken.transfer(
        await ccipSMASource.getAddress(),
        parseEther('100')
      );

      // Have CCIPSMA approve CCIP to spend its LINK tokens
      await ccipSMASource.approveToken(
        await linkToken.getAddress(),
        await ccipSource.getAddress(),
        parseEther('1000000000000000000000000')
      );

      // Send updatePPM through CCIPSMA to CCIP
      const sendUpdatePPMTx = await ccipSMASource.sendUpdatePPM(
        CHAIN_SELECTOR_DEST,
        await ccipSMADest.getAddress(),
        custodyId,
        updateVerificationData,
        await linkToken.getAddress()
      );
      const sendReceipt = await sendUpdatePPMTx.wait();

      // Get contract addresses
      const ccipSMAAddress = await ccipSMASource.getAddress();
      const ccipSourceAddress = await ccipSource.getAddress();

      // Verify message sent event on CCIPSMA
      const messageSentEventCCIPSMA = sendReceipt?.logs.find((log) => {
        const eventLog = log as EventLog;
        return (
          eventLog.eventName === 'MessageSent' &&
          eventLog.address === ccipSMAAddress
        );
      }) as EventLog;
      expect(messageSentEventCCIPSMA).to.not.be.undefined;
      expect(messageSentEventCCIPSMA.args[0]).to.equal(CHAIN_SELECTOR_DEST);
      expect(messageSentEventCCIPSMA.args[1]).to.equal(
        await ccipSMADest.getAddress()
      );

      // Simulate CCIP Router delivering the message to destination
      const routerAddress = await router.getAddress();
      await hre.network.provider.send('hardhat_impersonateAccount', [
        routerAddress,
      ]);
      await hre.network.provider.send('hardhat_setBalance', [
        routerAddress,
        hre.ethers.toBeHex(hre.ethers.parseEther('1')),
      ]);
      const routerSigner = await hre.ethers.getSigner(routerAddress);

      // Create the CCIP message that would be sent by the router
      const abiCoder = hre.ethers.AbiCoder.defaultAbiCoder();
      const targetSMAAddress = await ccipSMADest.getAddress();
      const timestamp = await time.latest();
      const sig = {
        e: hexlify(randomBytes(32)) as `0x${string}`,
        s: hexlify(randomBytes(32)) as `0x${string}`,
      };
      const ccipMessage = {
        messageId: MOCK_MESSAGE_ID,
        sourceChainSelector: CHAIN_SELECTOR_SOURCE,
        sender: abiCoder.encode(['address'], [ccipSourceAddress]),
        data: abiCoder.encode(
          ['tuple(uint8,address,bytes)'],
          [
            [
              0, // UPDATE_PPM = 0
              targetSMAAddress, // Convert to checksum address
              abiCoder.encode(
                [
                  'bytes32',
                  'tuple(bytes32,uint8,uint256,tuple(uint8,bytes32),tuple(bytes32,bytes32),bytes32[])',
                ],
                [
                  custodyId,
                  [
                    custodyId,
                    updateVerificationData.state,
                    timestamp,
                    [
                      updateVerificationData.pubKey.parity,
                      updateVerificationData.pubKey.x,
                    ],
                    [sig.e, sig.s],
                    updateVerificationData.merkleProof,
                  ],
                ]
              ),
            ],
          ]
        ),
        destTokenAmounts: [],
      };

      // call Test verification contract before calling ccipReceive on the destination receiver
      const item = ppmHelper.getPPM()[1];
      const party = Array.isArray(item.party) ? item.party[0] : item.party;

      // Prepare the verification data for the destination receiver
      const destinationVerificationData = {
        id: custodyId,
        state: 0,
        timestamp: await time.latest(),
        pubKey: publicKey,
        sig: {
          e: hexlify(randomBytes(32)) as `0x${string}`,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(1),
      };

      // call Test verification contract before calling ccipReceive on the destination receiver
      await expect(
        testVerification.verifyLeaf(
          destinationVerificationData.id,
          destinationVerificationData.merkleProof,
          'updatePPM',
          chainId,
          await psymm.getAddress(),
          destinationVerificationData.state,
          item.args,
          party.parity,
          party.x
        )
      ).to.not.be.reverted;

      // Simulate the router calling ccipReceive on the destination receiver via ccip router
      const receiveTx = await ccipReceiverDest
        .connect(routerSigner)
        .ccipReceive(ccipMessage);
      const receiveReceipt = await receiveTx.wait();

      // Verify the message was received and processed
      const receiverAddress = await ccipReceiverDest.getAddress();
      const messageReceivedEvent = receiveReceipt?.logs.find((log) => {
        const eventLog = log as EventLog;
        return (
          eventLog.eventName === 'MessageReceivedAndForwarded' &&
          eventLog.address === receiverAddress
        );
      }) as EventLog;
      expect(messageReceivedEvent).to.not.be.undefined;
      expect(messageReceivedEvent.args[0]).to.equal(MOCK_MESSAGE_ID);
      expect(messageReceivedEvent.args[1]).to.equal(CHAIN_SELECTOR_SOURCE);
      expect(messageReceivedEvent.args[2]).to.equal(ccipSourceAddress);
      expect(messageReceivedEvent.args[3]).to.equal(targetSMAAddress);

      // Clean up impersonation
      await hre.network.provider.send('hardhat_stopImpersonatingAccount', [
        routerAddress,
      ]);
    });
  });

  describe('CCIPSMA Deployment and PPM Update via CCIP', () => {
    it('should deploy CCIPSMA through PSYMM and update PPM', async function () {
      const {
        psymm,
        factorySource,
        ccipSource,
        ccipReceiverSource,
        linkToken,
        owner,
      } = await loadFixture(deployFixture);

      // Get chain ID and PSYMM address
      const chainId = await hre.ethers.provider
        .getNetwork()
        .then((n) => Number(n.chainId));
      const psymmAddress = (await psymm.getAddress()) as `0x${string}`;
      const factoryAddress =
        (await factorySource.getAddress()) as `0x${string}`;

      // Setup PPMHelper and public key
      const ppmHelper = new PPMHelper(chainId, psymmAddress);
      const publicKey = {
        parity: 0,
        x: hexlify(randomBytes(32)) as `0x${string}`,
      };

      // 1. First action: Deploy CCIPSMA
      const deployDataForSMA = '0x' as `0x${string}`;
      // Get custody state
      const custodyState = 0;

      // Add deploy action to PPMHelper
      const deployActionIndex = ppmHelper.deploySMA(
        SMAType.CCIP,
        factoryAddress,
        deployDataForSMA as `0x${string}`,
        custodyState,
        publicKey
      );

      // Add update action to PPMHelper
      const updateActionIndex = ppmHelper.updatePPM(custodyState, publicKey);

      // Get custody ID that includes all actions
      const custodyId = ppmHelper.getCustodyID();

      // Setup initial custody state with LINK tokens
      const depositAmount = hre.ethers.parseEther('1');
      await linkToken.mint(owner.address, depositAmount);
      await linkToken.approve(psymmAddress, depositAmount);
      await psymm.addressToCustody(
        custodyId,
        await linkToken.getAddress(),
        depositAmount
      );

      // Setup verification data for deploy action
      const currentTimestamp = await time.latest();
      const deployTimestamp = currentTimestamp + 3600;

      const deployVerificationData = {
        id: custodyId,
        state: custodyState,
        timestamp: deployTimestamp,
        pubKey: publicKey,
        sig: {
          e: hexlify(randomBytes(32)) as `0x${string}`,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(deployActionIndex),
      };

      // Deploy CCIPSMA through PSYMM
      await time.setNextBlockTimestamp(deployTimestamp);
      const deployTx = await psymm.deploySMA(
        SMAType.CCIP,
        factoryAddress,
        deployDataForSMA,
        deployVerificationData
      );
      const deployReceipt = await deployTx.wait();

      // Find deployment event and get SMA address
      const deployEvent = deployReceipt?.logs.find((log) => {
        const eventLog = log as EventLog;
        return eventLog.eventName === 'SMADeployed';
      }) as EventLog;
      expect(deployEvent).to.not.be.undefined;
      const smaAddress = deployEvent.args[2];

      // Verify CCIPSMA initialization
      const ccipSMA = await hre.ethers.getContractAt('CCIPSMA', smaAddress);
      expect(await ccipSMA.pSymm()).to.equal(psymmAddress);
      expect(await ccipSMA.ccipContract()).to.equal(
        await ccipSource.getAddress()
      );
      expect(await ccipSMA.localCCIPReceiver()).to.equal(
        await ccipReceiverSource.getAddress()
      );
      expect(await ccipSMA.factory()).to.equal(factoryAddress);
      expect(await ccipSMA.custodyId()).to.equal(custodyId);

      // Setup verification data for PPM update
      const updateTimestamp = deployTimestamp + 1800;
      const newPPM = hre.ethers.id('new-ppm-value');

      const updateVerificationData = {
        id: custodyId,
        state: custodyState,
        timestamp: updateTimestamp,
        pubKey: publicKey,
        sig: {
          e: hexlify(randomBytes(32)) as `0x${string}`,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(updateActionIndex),
      };

      // Get PPM item for verification
      const ppmItem = ppmHelper.getPPM()[updateActionIndex];
      const party = Array.isArray(ppmItem.party)
        ? ppmItem.party[0]
        : ppmItem.party;

      // Update PPM
      await time.setNextBlockTimestamp(updateTimestamp);
      const updateTx = await psymm.updatePPM(newPPM, updateVerificationData);
      const updateReceipt = await updateTx.wait();

      // Verify PPM update event
      const ppmEvent = updateReceipt?.logs.find(
        (log) => (log as EventLog).eventName === 'PPMUpdated'
      ) as EventLog;
      expect(ppmEvent).to.not.be.undefined;
      expect(ppmEvent.args[1]).to.equal(newPPM);

      // Verify PPM was updated
      expect(await psymm.getPPM(custodyId)).to.equal(newPPM);
    });

    it('should send updatePPM through CCIPSMA to CCIP', async function () {
      const {
        psymm,
        owner,
        linkToken,
        ccipSource,
        ccipSMASource,
        ppmHelper,
        publicKey,
      } = await loadFixture(deployCCIPSMA);

      // Get Custody Id
      const custodyId = ppmHelper.getCustodyID();

      // Setup verification data for PPM update
      const currentTimestamp = await time.latest();
      const updateTimestamp = currentTimestamp + 3600;

      const updateVerificationData = {
        id: custodyId,
        state: 0,
        timestamp: updateTimestamp,
        pubKey: publicKey,
        sig: {
          e: hexlify(randomBytes(32)) as `0x${string}`,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(1),
      };

      // Update PPM
      const newPPM = hre.ethers.id('new-ppm-value');
      await time.setNextBlockTimestamp(updateTimestamp);
      const updateTx = await psymm.updatePPM(newPPM, updateVerificationData);
      const updateReceipt = await updateTx.wait();

      // Verify PPM update event
      const ppmEvent = updateReceipt?.logs.find(
        (log) => (log as EventLog).eventName === 'PPMUpdated'
      ) as EventLog;
      expect(ppmEvent).to.not.be.undefined;
      expect(ppmEvent.args[1]).to.equal(newPPM);

      // Verify PPM was updated
      expect(await psymm.getPPM(custodyId)).to.equal(newPPM);

      // Transfer LINK tokens to CCIPSMA for fees
      await linkToken.transfer(
        await ccipSMASource.getAddress(),
        parseEther('100')
      );

      // Have CCIPSMA approve CCIP to spend its LINK tokens
      await ccipSMASource.approveToken(
        await linkToken.getAddress(),
        await ccipSource.getAddress(),
        parseEther('1000000000000000000000000')
      );

      // Send updatePPM through CCIPSMA to CCIP
      const sendUpdatePPMTx = await ccipSMASource.sendUpdatePPM(
        CHAIN_SELECTOR_DEST,
        await ccipSMASource.getAddress(),
        newPPM,
        updateVerificationData,
        await linkToken.getAddress()
      );
      const sendReceipt = await sendUpdatePPMTx.wait();

      // Get contract addresses
      const ccipSMAAddress = await ccipSMASource.getAddress();
      const ccipSourceAddress = await ccipSource.getAddress();

      // Verify message sent event on CCIPSMA (Implicitly verifies message sent on CCIP)
      const messageSentEventCCIPSMA = sendReceipt?.logs.find((log) => {
        const eventLog = log as EventLog;
        return (
          eventLog.eventName === 'MessageSent' &&
          eventLog.address === ccipSMAAddress
        );
      }) as EventLog;
      expect(messageSentEventCCIPSMA).to.not.be.undefined;
      expect(messageSentEventCCIPSMA.args[0]).to.equal(CHAIN_SELECTOR_DEST);
      expect(messageSentEventCCIPSMA.args[1]).to.equal(ccipSMAAddress);
    });

    it('should whitelist CCIPSMA through PSYMM and update PPM', async function () {
      const { psymm, owner, linkToken, ppmHelper, ccipSMASource, publicKey } =
        await loadFixture(deployCCIPSMA);

      // Get custody ID
      const custodyId = ppmHelper.getCustodyID();

      // Setup verification data for PPM update
      const currentTimestamp = await time.latest();
      const updateTimestamp = currentTimestamp + 3600;

      const updateVerificationData = {
        id: custodyId,
        state: 0,
        timestamp: updateTimestamp,
        pubKey: publicKey,
        sig: {
          e: hexlify(randomBytes(32)) as `0x${string}`,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(1),
      };

      // Update PPM
      const newPPM = hre.ethers.id('new-ppm-value');
      await time.setNextBlockTimestamp(updateTimestamp);
      const updateTx = await psymm.updatePPM(newPPM, updateVerificationData);
      const updateReceipt = await updateTx.wait();

      // Verify PPM update event
      const ppmEvent = updateReceipt?.logs.find(
        (log) => (log as EventLog).eventName === 'PPMUpdated'
      ) as EventLog;
      expect(ppmEvent).to.not.be.undefined;
      expect(ppmEvent.args[1]).to.equal(newPPM);

      // Verify PPM was updated
      expect(await psymm.getPPM(custodyId)).to.equal(newPPM);
    });

    it('Should deploy CCIPSMA directly and whitelist it in PSYMM', async function () {
      const {
        psymm,
        owner,
        ccipSource,
        ccipReceiverSource,
        factorySource,
        ppmHelper,
        publicKey,
        custodyId,
      } = await loadFixture(deployCCIPSMA);

      // Deploy CCIPSMA directly
      const CCIPSMAFactory = await ethers.getContractFactory('CCIPSMA');
      const ccipSMA = await CCIPSMAFactory.deploy(
        await psymm.getAddress(),
        await ccipSource.getAddress(), // generate random address
        await ccipReceiverSource.getAddress(), // mock chain selector
        await factorySource.getAddress(), // mock receiver
        custodyId, // custodyId
        owner.address // whitelisted caller
      );

      // Setup verification data for whitelisting
      const currentTimestamp = await time.latest();
      const updatePPMTimestamp = currentTimestamp + 3600;
      const updatePPMNullifier = hexlify(randomBytes(32)) as `0x${string}`;

      const updatePPMVerificationData = {
        id: custodyId,
        state: 0,
        timestamp: updatePPMTimestamp,
        pubKey: publicKey,
        sig: {
          e: updatePPMNullifier,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(1),
      };

      await time.setNextBlockTimestamp(updatePPMTimestamp);

      // Add whitelist action to PPM
      const whitelistActionIndex = ppmHelper.whitelistSMA(
        SMAType.CCIP,
        (await ccipSMA.getAddress()) as `0x${string}`,
        0,
        publicKey
      );

      // Update PPM on psymm
      const newPPM = ppmHelper.getCustodyID();
      const updatePPMTx = await psymm.updatePPM(
        newPPM,
        updatePPMVerificationData
      );
      const updatePPMReceipt = await updatePPMTx.wait();

      // Setup verification data for whitelisting
      const whitelistTimestamp = updatePPMTimestamp + 3600;
      const nullifier = hexlify(randomBytes(32)) as `0x${string}`;

      const verificationData = {
        id: custodyId,
        state: 0,
        timestamp: whitelistTimestamp,
        pubKey: publicKey,
        sig: {
          e: nullifier,
          s: hexlify(randomBytes(32)) as `0x${string}`,
        },
        merkleProof: ppmHelper.getMerkleProof(whitelistActionIndex),
      };

      await time.setNextBlockTimestamp(whitelistTimestamp);

      // Whitelist the CCIPSMA
      const tx = await psymm.whitelistSMA(
        SMAType.CCIP,
        await ccipSMA.getAddress(),
        verificationData
      );

      const receipt = await tx.wait();
      const event = receipt?.logs.find((log) => {
        const eventLog = log as EventLog;
        return eventLog.eventName === 'SMAWhitelisted';
      }) as EventLog;

      expect(event).to.not.be.undefined;
      expect(event!.args.smaType).to.equal(SMAType.CCIP);
      expect(event!.args.smaAddress).to.equal(await ccipSMA.getAddress());

      // Verify the SMA is whitelisted
      const isWhitelisted = await psymm.getwhitelistedSMA(
        custodyId,
        await ccipSMA.getAddress()
      );
      expect(isWhitelisted).to.be.true;
    });
  });
});
