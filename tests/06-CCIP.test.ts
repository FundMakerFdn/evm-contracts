import { expect } from 'chai';
import { ethers, network } from 'hardhat'; // Standard Hardhat import
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import {
  CCIP,
  CCIPReceiver,
  CCIPSMAFactory,
  CCIPSMA,
  PSYMM,
  MockERC20,
  MockCCIPRouter,
} from '../typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ZeroAddress, AbiCoder, MaxUint256 } from 'ethers'; // For types

interface MockRouterInterface {
  getFee: (destinationChainSelector: bigint, message: any) => Promise<bigint>;
  ccipSend: (destinationChainSelector: bigint, message: any) => Promise<string>;
}

let CUSTODY_ID_UNDER_TEST: string;

describe('CCIP End-to-End Integration', function () {
  const CHAIN_SELECTOR_SRC = 1n;
  const CHAIN_SELECTOR_DEST = 2n;
  const NEW_PPM_ROOT = ethers.id('new-ppm-root-ccip-test');
  const MOCK_FEE_AMOUNT = ethers.parseEther('0.1');
  const MOCK_CCIP_MESSAGE_ID = ethers.keccak256(
    ethers.toUtf8Bytes('mock-ccip-message-id')
  );

  async function deployFullCCIPFixture() {
    const [owner, psymmOwner, ccipSmaOwner, user1, otherUser] =
      await ethers.getSigners();

    const MockERC20Factory = await ethers.getContractFactory('MockERC20');
    const linkToken = await MockERC20Factory.deploy('ChainLink', 'LINK', 18);
    await linkToken.waitForDeployment();

    const MockCCIPRouterFactory = await ethers.getContractFactory(
      'MockCCIPRouter'
    );
    const mockRouterContract = await MockCCIPRouterFactory.deploy();

    const PSYMMFactory = await ethers.getContractFactory('PSYMM');
    const psymm = await PSYMMFactory.connect(psymmOwner).deploy();
    await psymm.waitForDeployment();

    const abiCoder = AbiCoder.defaultAbiCoder();
    const networkData = await ethers.provider.getNetwork();
    const chainId = networkData.chainId;
    const psymmAddress = await psymm.getAddress();
    const encodedEmptyArgs = abiCoder.encode([], []);
    const stateForLeaf = 0;
    const pubKeyParityForLeaf = 0;
    const pubKeyXForLeaf = ethers.ZeroHash;

    const updatePPMActionLeafInnerHashPreImage = abiCoder.encode(
      ['string', 'uint256', 'address', 'uint8', 'bytes', 'uint8', 'bytes32'],
      [
        'updatePPM',
        chainId,
        psymmAddress,
        stateForLeaf,
        encodedEmptyArgs,
        pubKeyParityForLeaf,
        pubKeyXForLeaf,
      ]
    );
    const updatePPMActionLeafInnerHash = ethers.keccak256(
      updatePPMActionLeafInnerHashPreImage
    );
    CUSTODY_ID_UNDER_TEST = ethers.keccak256(
      ethers.solidityPacked(['bytes32'], [updatePPMActionLeafInnerHash])
    );

    await psymm
      .connect(psymmOwner)
      .addressToCustody(CUSTODY_ID_UNDER_TEST, await linkToken.getAddress(), 0);

    const ccipSourceFactory = await ethers.getContractFactory('CCIP');
    const ccipSource = await ccipSourceFactory.deploy(
      await mockRouterContract.getAddress()
    );
    await ccipSource.waitForDeployment();

    const ccipReceiverSourceFactory = await ethers.getContractFactory(
      'CCIPReceiver'
    );
    const ccipReceiverSource = await ccipReceiverSourceFactory.deploy(
      await mockRouterContract.getAddress()
    );
    await ccipReceiverSource.waitForDeployment();

    const ccipSMAFactorySourceFactory = await ethers.getContractFactory(
      'CCIPSMAFactory'
    );
    const ccipSMAFactorySource = await ccipSMAFactorySourceFactory.deploy(
      await psymm.getAddress(),
      await ccipSource.getAddress(),
      await ccipReceiverSource.getAddress()
    );
    await ccipSMAFactorySource.waitForDeployment();

    const ccipDestFactory = await ethers.getContractFactory('CCIP');
    const ccipDest = await ccipDestFactory.deploy(
      await mockRouterContract.getAddress()
    );
    await ccipDest.waitForDeployment();

    const ccipReceiverDestFactory = await ethers.getContractFactory(
      'CCIPReceiver'
    );
    const ccipReceiverDest = await ccipReceiverDestFactory.deploy(
      await mockRouterContract.getAddress()
    );
    await ccipReceiverDest.waitForDeployment();

    const ccipSMAFactoryDestFactory = await ethers.getContractFactory(
      'CCIPSMAFactory'
    );
    const ccipSMAFactoryDest = await ccipSMAFactoryDestFactory.deploy(
      await psymm.getAddress(),
      await ccipDest.getAddress(),
      await ccipReceiverDest.getAddress()
    );
    await ccipSMAFactoryDest.waitForDeployment();

    const CCIPSMA_DestFactory = await ethers.getContractFactory('CCIPSMA');
    const ccipSMADest = await CCIPSMA_DestFactory.connect(owner).deploy(
      await psymm.getAddress(),
      await ccipDest.getAddress(),
      await ccipReceiverDest.getAddress(),
      await ccipSMAFactoryDest.getAddress(),
      CUSTODY_ID_UNDER_TEST,
      owner.address
    );
    await ccipSMADest.waitForDeployment();

    await ccipSource.setDestinationCCIPReceiver(
      CHAIN_SELECTOR_DEST,
      await ccipReceiverDest.getAddress()
    );

    await ccipReceiverDest.setSourceSenderWhitelist(
      CHAIN_SELECTOR_SRC,
      await ccipSource.getAddress(),
      true
    );
    await ccipReceiverDest.setLocalDestinationWhitelist(
      await ccipSMADest.getAddress(),
      true
    );

    await ccipSMAFactorySource.setDestinationChain(CHAIN_SELECTOR_DEST, true);

    await ccipSource.setCallerWhitelist(ccipSmaOwner.address, true);

    await linkToken.mint(ccipSmaOwner.address, ethers.parseEther('100'));
    await linkToken
      .connect(ccipSmaOwner)
      .approve(await ccipSource.getAddress(), MaxUint256);

    await mockRouterContract.setFee(MOCK_FEE_AMOUNT);
    await mockRouterContract.setMessageId(MOCK_CCIP_MESSAGE_ID);

    return {
      owner,
      psymmOwner,
      ccipSmaOwner,
      user1,
      otherUser,
      linkToken,
      mockRouter: mockRouterContract,
      psymm,
      ccipSource,
      ccipReceiverSource,
      ccipSMAFactorySource,
      ccipDest,
      ccipReceiverDest,
      ccipSMAFactoryDest,
      ccipSMADest,
      CUSTODY_ID_FOR_TESTING: CUSTODY_ID_UNDER_TEST,
    };
  }

  describe('PSYMM Setup and Initial State', function () {
    it('Should have PSYMM deployed', async function () {
      const { psymm } = await loadFixture(deployFullCCIPFixture);
      expect(await psymm.getAddress()).to.not.equal(ZeroAddress);
    });
  });

  describe('CCIPSMAFactory Configuration', function () {
    it('Should set local CCIPReceiver address correctly', async function () {
      const { ccipSMAFactorySource, ccipReceiverSource } = await loadFixture(
        deployFullCCIPFixture
      );
      expect(await ccipSMAFactorySource.localCCIPReceiverAddress()).to.equal(
        await ccipReceiverSource.getAddress()
      );
    });

    it('Should allow owner to update local CCIPReceiver address', async function () {
      const { owner, ccipSMAFactorySource, otherUser } = await loadFixture(
        deployFullCCIPFixture
      );
      await ccipSMAFactorySource
        .connect(owner)
        .setLocalCCIPReceiver(otherUser.address);
      expect(await ccipSMAFactorySource.localCCIPReceiverAddress()).to.equal(
        otherUser.address
      );
    });
  });

  describe('Sending and Receiving UpdatePPM Message via CCIP', function () {
    it('Should allow a whitelisted caller on CCIPSource to send an UpdatePPM message that is processed by CCIPSMADest', async function () {
      const {
        psymmOwner,
        ccipSmaOwner,
        mockRouter,
        psymm,
        ccipSource,
        ccipReceiverDest,
        ccipSMADest,
        linkToken,
        CUSTODY_ID_FOR_TESTING,
      } = await loadFixture(deployFullCCIPFixture);

      const currentTimestamp = await time.latest();
      const verificationDataObj = {
        id: CUSTODY_ID_FOR_TESTING,
        state: 0,
        timestamp: currentTimestamp,
        pubKey: { parity: 0, x: ethers.ZeroHash },
        sig: { e: ethers.ZeroHash, s: ethers.ZeroHash },
        merkleProof: [], // Empty proof is valid because PPMs[CUSTODY_ID_FOR_TESTING] is the leaf itself initially
      };
      const verificationDataArray = [
        verificationDataObj.id,
        verificationDataObj.state,
        verificationDataObj.timestamp,
        [verificationDataObj.pubKey.parity, verificationDataObj.pubKey.x],
        [verificationDataObj.sig.e, verificationDataObj.sig.s],
        verificationDataObj.merkleProof,
      ];

      const abiCoder = AbiCoder.defaultAbiCoder();

      const ccipMessagePayloadArray = [
        0,
        await ccipSMADest.getAddress(),
        abiCoder.encode(
          [
            'bytes32',
            '(bytes32,uint8,uint256,(uint8,bytes32),(bytes32,bytes32),bytes32[])',
          ],
          [NEW_PPM_ROOT, verificationDataArray]
        ),
      ];
      const encodedCCIPMessage = abiCoder.encode(
        ['(uint8,address,bytes)'],
        [ccipMessagePayloadArray]
      );

      const psymmOnDestination = psymm;
      const initialPPMValue = await psymmOnDestination.getPPM(
        CUSTODY_ID_FOR_TESTING
      );
      expect(initialPPMValue).to.equal(
        CUSTODY_ID_FOR_TESTING,
        'Initial PPM value on destination PSYMM should be the custody ID itself.'
      );

      // --- Send the CCIP message from source ---
      await expect(
        ccipSource
          .connect(ccipSmaOwner)
          .sendMessage(
            CHAIN_SELECTOR_DEST,
            encodedCCIPMessage,
            await linkToken.getAddress()
          )
      )
        .to.emit(ccipSource, 'CCIPMessageSent')
        .withArgs(
          MOCK_CCIP_MESSAGE_ID,
          CHAIN_SELECTOR_DEST,
          await ccipReceiverDest.getAddress(),
          encodedCCIPMessage,
          await linkToken.getAddress(),
          MOCK_FEE_AMOUNT
        );

      // --- Simulate router delivering the message to destination receiver ---
      const any2EvmMessage = {
        messageId: MOCK_CCIP_MESSAGE_ID,
        sourceChainSelector: CHAIN_SELECTOR_SRC,
        sender: abiCoder.encode(['address'], [await ccipSource.getAddress()]),
        data: encodedCCIPMessage,
        destTokenAmounts: [],
      };

      const mockRouterAddress = await mockRouter.getAddress();
      await network.provider.send('hardhat_impersonateAccount', [
        mockRouterAddress,
      ]);
      await network.provider.send('hardhat_setBalance', [
        mockRouterAddress,
        ethers.toBeHex(ethers.parseEther('1')),
      ]);
      const mockRouterSigner = await ethers.getSigner(mockRouterAddress);

      // This call will trigger ccipSMADest.handleCCIPMessage, which should call psymm.updatePPM
      await expect(
        ccipReceiverDest.connect(mockRouterSigner).ccipReceive(any2EvmMessage)
      )
        .to.emit(ccipSMADest, 'UpdatePPMMessageReceived') // Assuming CCIPSMA emits this
        .withArgs(
          CUSTODY_ID_FOR_TESTING,
          NEW_PPM_ROOT,
          verificationDataObj.timestamp
        );

      await network.provider.send('hardhat_stopImpersonatingAccount', [
        mockRouterAddress,
      ]);

      const finalPPMValue = await psymmOnDestination.getPPM(
        CUSTODY_ID_FOR_TESTING
      );
      expect(finalPPMValue).to.equal(
        NEW_PPM_ROOT,
        'Final PPM value on destination PSYMM should be updated to NEW_PPM_ROOT after CCIP processing.'
      );
    });

    it('Should revert if a non-whitelisted source CCIP contract tries to send a message', async function () {
      const { mockRouter, ccipReceiverDest, otherUser } = await loadFixture(
        deployFullCCIPFixture
      );
      const encodedCCIPMessage = '0xdeadbeef';
      const abiCoder = AbiCoder.defaultAbiCoder();

      const any2EvmMessage = {
        messageId: MOCK_CCIP_MESSAGE_ID,
        sourceChainSelector: CHAIN_SELECTOR_SRC,
        sender: abiCoder.encode(['address'], [otherUser.address]),
        data: encodedCCIPMessage,
        destTokenAmounts: [],
      };

      const mockRouterAddress = await mockRouter.getAddress();
      await network.provider.send('hardhat_impersonateAccount', [
        mockRouterAddress,
      ]);
      await network.provider.send('hardhat_setBalance', [
        mockRouterAddress,
        ethers.toBeHex(ethers.parseEther('1')),
      ]);
      const mockRouterSigner = await ethers.getSigner(mockRouterAddress);

      await expect(
        ccipReceiverDest.connect(mockRouterSigner).ccipReceive(any2EvmMessage)
      ).to.be.rejectedWith(
        'CCIPReceiver: Source CCIP contract not whitelisted'
      );

      await network.provider.send('hardhat_stopImpersonatingAccount', [
        mockRouterAddress,
      ]);
    });

    it('Should revert if message targets a non-whitelisted local SMA', async function () {
      const { mockRouter, ccipSource, ccipReceiverDest, otherUser } =
        await loadFixture(deployFullCCIPFixture);

      const abiCoder = AbiCoder.defaultAbiCoder();
      const ccipMessagePayloadArray = [0, otherUser.address, '0x'];
      const encodedCCIPMessage = abiCoder.encode(
        ['(uint8,address,bytes)'],
        [ccipMessagePayloadArray]
      );

      const any2EvmMessage = {
        messageId: MOCK_CCIP_MESSAGE_ID,
        sourceChainSelector: CHAIN_SELECTOR_SRC,
        sender: abiCoder.encode(['address'], [await ccipSource.getAddress()]),
        data: encodedCCIPMessage,
        destTokenAmounts: [],
      };

      const mockRouterAddress = await mockRouter.getAddress();
      await network.provider.send('hardhat_impersonateAccount', [
        mockRouterAddress,
      ]);
      await network.provider.send('hardhat_setBalance', [
        mockRouterAddress,
        ethers.toBeHex(ethers.parseEther('1')),
      ]);
      const mockRouterSigner = await ethers.getSigner(mockRouterAddress);

      await expect(
        ccipReceiverDest.connect(mockRouterSigner).ccipReceive(any2EvmMessage)
      ).to.be.rejectedWith('CCIPReceiver: Target local SMA not whitelisted');

      await network.provider.send('hardhat_stopImpersonatingAccount', [
        mockRouterAddress,
      ]);
    });
  });
});

async function getBlockTimestamp(): Promise<number> {
  const blockNumber = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNumber);
  if (!block) throw new Error('Block not found');
  return block.timestamp;
}
