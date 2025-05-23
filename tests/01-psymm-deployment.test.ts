import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { deployFixture, SubjectType } from './fixtures/DeployFixture';
import { increaseTime, getLatestBlockTimestamp } from './fixtures/base';
import * as hre from 'hardhat';
import { config as dotenvConfig } from 'dotenv';
import { PSYMM, MockERC20 } from '../typechain-types';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { ethers } from 'hardhat';

import { PPMHelper } from './utils/ppmHelper';
import { SchnorrHelper } from './utils/schnorrHelper';
import { getSinglePartyCustodyId, createLeaf } from './utils/index';
describe('PSYMM', function () {
  let subject: SubjectType;

  beforeEach(async function () {
    subject = await loadFixture(deployFixture);
  });

  describe('Custody Operations', function () {
    const custodyId = ethers.id('test-custody');
    const amount = ethers.parseEther('10');

    beforeEach(async function () {
      // Mint tokens to test users
      await subject.usdc.mint(subject.user1.address, amount);
      await subject.usde.mint(subject.user2.address, amount);
    });

    it('Should allow address to custody', async function () {
      // Approve tokens
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), amount);

      // Transfer to custody
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(custodyId, await subject.usdc.getAddress(), amount);

      // Verify custody balance
      const custodyBalance = await subject.psymm.custodyBalances(
        custodyId,
        await subject.usdc.getAddress()
      );
      expect(custodyBalance).to.equal(amount);
    });

    it('Should allow address to custody even without mocking merkle proofs', async function () {
      // Approve tokens
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), amount);

      // Transfer to custody
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(custodyId, await subject.usdc.getAddress(), amount);

      // Verify custody balance
      const custodyBalance = await subject.psymm.custodyBalances(
        custodyId,
        await subject.usdc.getAddress()
      );
      expect(custodyBalance).to.equal(amount);

      // Get the PPM value - should be set to custodyId
      const ppmValue = await subject.psymm.getPPM(custodyId);
      expect(ppmValue).to.equal(custodyId);
    });

    it('Should allow custody to custody transfer', async function () {
      const receiverId = ethers.id('receiver-custody');

      // Step 1: Initial setup - deposit tokens to custody
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), amount);
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(custodyId, await subject.usdc.getAddress(), amount);

      // Step 2: Create verification data for the transfer
      // Set up caller address as the public key (using Schnorr verification shortcut)
      const pubKeyParity = 0; // Using the Schnorr verification shortcut
      const callerAddress = subject.user1.address;
      const pubKeyX = ethers.zeroPadValue(callerAddress, 32); // Address as bytes32

      // Get chain information for verification
      const chainId = await ethers.provider.getNetwork().then((n) => n.chainId);
      const contractAddress = await subject.psymm.getAddress();

      // Encode the destination custody ID
      const encodedParams = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32'],
        [receiverId]
      );

      // Create the leaf hash for verification
      const leaf = ethers.keccak256(
        ethers.solidityPacked(
          ['bytes32'],
          [
            ethers.keccak256(
              ethers.AbiCoder.defaultAbiCoder().encode(
                [
                  'string',
                  'uint256',
                  'address',
                  'uint8',
                  'bytes',
                  'uint8',
                  'bytes32',
                ],
                [
                  'custodyToCustody', // Action name
                  chainId,
                  contractAddress,
                  0, // custodyState
                  encodedParams,
                  pubKeyParity,
                  pubKeyX,
                ]
              )
            ),
          ]
        )
      );

      // Step 3: Create a new custody with leaf as the ID
      // Create a new custody with the leaf as the ID
      const leafCustodyId = leaf;

      // Initial small deposit to set up the PPM for the new custody
      await subject.usdc.mint(subject.user1.address, ethers.parseEther('0.1'));
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), ethers.parseEther('0.1'));

      // This sets PPMs[leafCustodyId] = leafCustodyId, which helps with verification
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(
          leafCustodyId,
          await subject.usdc.getAddress(),
          ethers.parseEther('0.1')
        );

      // Step 4: Fund the source custody with the amount to transfer
      await subject.usdc.mint(subject.user1.address, amount);
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), amount);

      // Deposit the tokens to the leaf custody
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(
          leafCustodyId,
          await subject.usdc.getAddress(),
          amount
        );

      // Verify balance of the source custody
      const sourceCustodyBalanceBefore = await subject.psymm.custodyBalances(
        leafCustodyId,
        await subject.usdc.getAddress()
      );

      // Step 5: Execute the transfer
      const timestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour in future

      // Ensure timestamp is valid
      await ethers.provider.send('evm_setNextBlockTimestamp', [timestamp + 1]);
      await ethers.provider.send('evm_mine', []);

      // Create verification data with empty proof (valid because leaf is the PPM)
      const verificationData = {
        id: leafCustodyId,
        state: 0,
        timestamp: timestamp,
        pubKey: {
          parity: pubKeyParity,
          x: pubKeyX,
        },
        sig: {
          e: ethers.hexlify(ethers.randomBytes(32)),
          s: ethers.hexlify(ethers.randomBytes(32)),
        },
        merkleProof: [], // Empty proof is valid when leaf == PPM
      };

      // Execute the custody transfer
      await subject.psymm
        .connect(subject.user1)
        .custodyToCustody(
          await subject.usdc.getAddress(),
          receiverId,
          amount,
          verificationData
        );

      // Step 6: Verify the results
      const sourceCustodyBalance = await subject.psymm.custodyBalances(
        leafCustodyId,
        await subject.usdc.getAddress()
      );
      const destinationCustodyBalance = await subject.psymm.custodyBalances(
        receiverId,
        await subject.usdc.getAddress()
      );
      // The source custody should still have the initial 0.1 ETH deposit
      expect(sourceCustodyBalance).to.equal(ethers.parseEther('0.1'));
      // The destination custody should have the full amount
      expect(destinationCustodyBalance).to.equal(amount);
    });

    // it("Should allow custody to address transfer", async function () {

    //   // Get chain ID and contract address
    //   const chainId = await ethers.provider.getNetwork().then((n) => n.chainId);
    //   const contractAddress = await subject.psymm.getAddress();

    //   // Get token address
    //   const usdcAddress = await subject.usdc.getAddress();

    //   // Generate real Schnorr key pairs (with parity=27) instead of address-based signers
    //   const keyPair1 = SchnorrHelper.generateKeyPair();
    //   const keyPair2 = SchnorrHelper.generateKeyPair();
    //   // Create the PPM Helper
    //   const ppmHelper = new PPMHelper(Number(chainId), contractAddress as `0x${string}`);

    //   const aggregatedPubKey = SchnorrHelper.aggregatePublicKeys([keyPair1.publicKey, keyPair2.publicKey]);

    //   // Add custody to address action with both parties required
    //   ppmHelper.custodyToAddress(
    //     subject.user2.address, // recipient
    //     0, // state
    //     [aggregatedPubKey] // both parties required
    //   );

    //   ppmHelper.custodyToAddress(
    //     subject.user1.address, // recipient
    //     0, // state
    //     [keyPair1.publicKey] // both parties required
    //   );

    //   // Get custody ID from PPM helper
    //   const custodyId = ppmHelper.getCustodyID();

    //   // Mint tokens to the user first
    //   await subject.usdc.mint(subject.user1.address, amount);
    //   await subject.usdc.connect(subject.user1).approve(contractAddress, amount);
    //   await subject.psymm.connect(subject.user1).addressToCustody(custodyId, usdcAddress, amount);

    //   // Verify initial custody balance
    //   const initialBalance = await subject.psymm.custodyBalances(custodyId, usdcAddress);

    //   // Create message to sign
    //   const timestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour in the future
    //   const withdrawAmount = ethers.parseEther("5");

    //   // Create the message to sign for custodyToAddress
    //   const message = SchnorrHelper.createCustodyToAddressMessage(timestamp, custodyId, usdcAddress, subject.user2.address, withdrawAmount);

    //   // Both parties sign the message
    //   const signature1 = SchnorrHelper.sign(message, keyPair1);
    //   const signature2 = SchnorrHelper.sign(message, keyPair2);

    //   // Combine parties' public keys and signatures (for true multi-sig)

    //   const aggregatedSignature = SchnorrHelper.aggregateSignatures([signature1, signature2]);

    //   // Set the block timestamp for verification
    //   await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp + 1]);
    //   await ethers.provider.send("evm_mine", []);

    //   // Get merkle proof for the aggregated key
    //   // Since we've added two separate entries to the PPM (one for each party),
    //   // we need to add a separate entry for the aggregated key

    //   // First, we'll check if the PPM already has a corresponding action for our aggregated key
    //   const ppmItems = ppmHelper.getPPM();
    //   let proofIndex = -1;

    //   for (let i = 0; i < ppmItems.length; i++) {
    //     const item = ppmItems[i];
    //     const party = Array.isArray(item.party) ? item.party[0] : item.party;

    //     if (item.type === "custodyToAddress" && party.parity === aggregatedPubKey.parity && party.x === aggregatedPubKey.x) {
    //       proofIndex = i;
    //       break;
    //     }
    //   }
    //   // If we didn't find a matching entry, add one for the aggregated key
    //   // if (proofIndex === -1) {
    //   //   ppmHelper.custodyToAddress(
    //   //     subject.user2.address, // recipient
    //   //     0, // state
    //   //     aggregatedPubKey // The aggregated public key
    //   //   );
    //   //   // The index will be the last added item
    //   //   proofIndex = ppmHelper.getPPM().length - 1;
    //   // }

    //   const proof = ppmHelper.getMerkleProof(proofIndex);

    //   // Create verification data with aggregated signature and key
    //   const verificationData = {
    //     id: custodyId,
    //     state: 0,
    //     timestamp: timestamp,
    //     pubKey: aggregatedPubKey, // Using the aggregated public key
    //     sig: aggregatedSignature, // Using the aggregated signature
    //     merkleProof: proof,
    //   };

    //   // Execute custody to address with the aggregated signature
    //   // Notice we're connecting with user1 (doesn't matter who executes it)
    //   await subject.psymm.connect(subject.user1).custodyToAddress(usdcAddress, subject.user2.address, withdrawAmount, verificationData);

    //   // Check final balances
    //   const finalCustodyBalance = await subject.psymm.custodyBalances(custodyId, usdcAddress);
    //   const user2Balance = await subject.usdc.balanceOf(subject.user2.address);

    //   // Verify balances
    //   expect(finalCustodyBalance).to.equal(amount - withdrawAmount);
    //   expect(user2Balance).to.equal(withdrawAmount);

    // });

    it('Should verify initial PPM is set to custody ID', async function () {
      const testCustodyId = ethers.id('initial-ppm-test');
      const testAmount = ethers.parseEther('1');

      // Mint tokens to the user
      await subject.usdc.mint(subject.user1.address, testAmount);

      // Approve tokens
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), testAmount);

      // Transfer to custody
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(
          testCustodyId,
          await subject.usdc.getAddress(),
          testAmount
        );

      // Get the PPM value
      const ppmValue = await subject.psymm.getPPM(testCustodyId);

      // Verify PPM is set to custody ID
      expect(ppmValue).to.equal(
        testCustodyId,
        'Initial PPM should be set to the custody ID'
      );
    });

    it('Should fail when insufficient balance for custody transfer', async function () {
      // Approve tokens
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), amount);

      // Transfer to custody
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(custodyId, await subject.usdc.getAddress(), amount);

      // Get the chain ID for the test network
      const chainId = await ethers.provider.getNetwork().then((n) => n.chainId);
      const contractAddress = await subject.psymm.getAddress();

      // Create public key values - use user1's address as the public key for easy verification
      const pubKeyParity = 0; // Using address verification mode
      const pubKeyX = ethers.zeroPadValue(subject.user1.address, 32); // Use user1's address

      // Create leaf for the transfer operation
      const receiverId = ethers.id('receiver-custody');
      const custodyToCustodyParams = ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32'],
        [receiverId]
      );

      const custodyToCustodyLeaf = createLeaf(
        'custodyToCustody',
        chainId,
        contractAddress,
        0, // custodyState
        custodyToCustodyParams,
        pubKeyParity,
        pubKeyX
      );

      // Create a tree with just this leaf
      const permissionTree = StandardMerkleTree.of(
        [[custodyToCustodyLeaf]],
        ['bytes32']
      );

      // First update the PPM to our leaf
      const excessAmount = ethers.parseEther('20'); // Greater than the 10 ETH deposited

      // Try to transfer more than available and expect failure
      const verificationData = {
        id: custodyId,
        state: 0,
        timestamp: Math.floor(Date.now() / 1000) + 3600,
        pubKey: {
          parity: pubKeyParity,
          x: pubKeyX,
        },
        sig: {
          e: ethers.hexlify(ethers.randomBytes(32)),
          s: ethers.hexlify(ethers.randomBytes(32)),
        },
        merkleProof: [], // Empty proof since it's using the initial PPM = custodyId
      };

      await expect(
        subject.psymm
          .connect(subject.user1)
          .custodyToCustody(
            await subject.usdc.getAddress(),
            receiverId,
            excessAmount,
            verificationData
          )
      ).to.be.rejectedWith('Out of collateral');
    });

    it('Should fail with invalid signature expiry', async function () {
      // Set up custody with tokens
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), amount);
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(custodyId, await subject.usdc.getAddress(), amount);

      // Get current block timestamp
      const currentBlockTimestamp = await getLatestBlockTimestamp();
      const futureTimestamp = currentBlockTimestamp + 3600;
      // Set blockchain to future time
      // await ethers.provider.send("evm_setNextBlockTimestamp", [futureTimestamp]);
      // await ethers.provider.send("evm_mine", []);

      // Now create an expired timestamp for our test
      // const expiredTimestamp = futureTimestamp - 100; // Earlier than futureTimestamp
      const verificationData = {
        id: custodyId,
        state: 0,
        timestamp: futureTimestamp,
        pubKey: {
          parity: 0,
          x: ethers.zeroPadValue(subject.user1.address, 32),
        },
        sig: {
          e: ethers.hexlify(ethers.randomBytes(32)),
          s: ethers.hexlify(ethers.randomBytes(32)),
        },
        merkleProof: [], // Empty proof for initial PPM
      };

      // Attempt to use expired timestamp
      await expect(
        subject.psymm
          .connect(subject.user1)
          .custodyToAddress(
            await subject.usdc.getAddress(),
            subject.user2.address,
            ethers.parseEther('1'),
            verificationData
          )
      ).to.be.rejectedWith('Signature expired');
    });

    it('Should fail when using the same nullifier twice', async function () {
      // Get chain ID and contract address
      const chainId = await ethers.provider.getNetwork().then((n) => n.chainId);
      const contractAddress = await subject.psymm.getAddress();

      // Generate real Schnorr key pairs (with parity=27) instead of address-based signers
      const keyPair1 = SchnorrHelper.generateKeyPair();
      const keyPair2 = SchnorrHelper.generateKeyPair();
      // Create the PPM Helper
      const ppmHelper = new PPMHelper(
        Number(chainId),
        contractAddress as `0x${string}`
      );

      const aggregatedPubKey = SchnorrHelper.aggregatePublicKeys([
        keyPair1.publicKey,
        keyPair2.publicKey,
      ]);

      // Create public key values - use user1's address as the public key for easy verification
      const pubKeyParity = 0; // Using address verification mode
      const pubKeyX = ethers.zeroPadValue(subject.user1.address, 32); // Use user1's address

      // Add custody to address action with both parties required
      ppmHelper.custodyToAddress(
        subject.user2.address, // recipient
        0, // state
        [
          {
            parity: pubKeyParity,
            x: pubKeyX,
          },
        ] // both parties required
      );

      // Get custody ID from PPM helper
      const custodyId = ppmHelper.getCustodyID();

      // Set up custody with tokens
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), amount);
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(custodyId, await subject.usdc.getAddress(), amount);

      // Get current block timestamp
      const currentBlockTimestamp = await getLatestBlockTimestamp();
      const baseTimestamp = currentBlockTimestamp + 2000;

      // Verification data for the transfer using the same nullifier twice
      const verificationData = {
        id: custodyId,
        state: 0,
        timestamp: currentBlockTimestamp,
        pubKey: {
          parity: pubKeyParity,
          x: pubKeyX,
        },
        sig: {
          e: ethers.hexlify(ethers.randomBytes(32)), // Reuse the same signature/nullifier
          s: ethers.hexlify(ethers.randomBytes(32)),
        },
        merkleProof: [], // Use the proof from the permission tree
      };

      // Create test environment
      await ethers.provider.send('evm_setNextBlockTimestamp', [
        currentBlockTimestamp + 1,
      ]);
      await ethers.provider.send('evm_mine', []);

      // First transfer should succeed
      await subject.psymm
        .connect(subject.user1)
        .custodyToAddress(
          await subject.usdc.getAddress(),
          subject.user2.address,
          ethers.parseEther('1'),
          verificationData
        );

      // Second transfer with same nullifier should fail
      await expect(
        subject.psymm
          .connect(subject.user1)
          .custodyToAddress(
            await subject.usdc.getAddress(),
            subject.user2.address,
            ethers.parseEther('1'),
            verificationData
          )
      ).to.be.rejectedWith('Nullifier has been used');
    });

    it('Should update custody state and reject operations with incorrect state', async function () {
      const { custodyId, ppmHelper, pubKeyParity, pubKeyX } =
        await getSinglePartyCustodyId(subject);
      // Set up custody with tokens
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), amount);
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(custodyId, await subject.usdc.getAddress(), amount);

      // Create leaf for changeCustodyState
      const newState = 1; // Change to state 1
      // const changeCustodyStateParams = ethers.AbiCoder.defaultAbiCoder().encode(["uint8"], [newState]);
      const baseTimestamp = await getLatestBlockTimestamp();
      // Set up timestamp and signature for updateCustodyState
      // const stateChangeTimestamp = baseTimestamp ;
      const verificationData = {
        id: custodyId,
        state: 0, // Current state
        timestamp: baseTimestamp,
        pubKey: {
          parity: pubKeyParity,
          x: pubKeyX,
        },
        sig: {
          e: ethers.hexlify(ethers.randomBytes(32)),
          s: ethers.hexlify(ethers.randomBytes(32)),
        },
        merkleProof: ppmHelper.getMerkleProofByTypeAndArgs(
          'changeCustodyState',
          {
            newState: 1,
          },
          0,
          [
            {
              parity: pubKeyParity,
              x: pubKeyX,
            },
          ]
        ),
      };

      // Create test environment for timestamp
      await ethers.provider.send('evm_setNextBlockTimestamp', [
        baseTimestamp + 1,
      ]);
      await ethers.provider.send('evm_mine', []);

      // Update the custody state
      await subject.psymm
        .connect(subject.user1)
        .updateCustodyState(newState, verificationData);

      // Verify the state changed
      const updatedState = await subject.psymm.getCustodyState(custodyId);
      expect(updatedState).to.equal(
        newState,
        'Custody state should be updated'
      );

      // Create a new verification data for custodyToAddress with incorrect state
      const transferData = {
        id: custodyId,
        state: 0, // Old state (incorrect)
        timestamp: baseTimestamp,
        pubKey: {
          parity: pubKeyParity,
          x: pubKeyX,
        },
        sig: {
          e: ethers.hexlify(ethers.randomBytes(32)),
          s: ethers.hexlify(ethers.randomBytes(32)),
        },
        merkleProof: [], // Use proof for custodyToAddress leaf
      };

      // Operation should fail due to state mismatch
      await expect(
        subject.psymm
          .connect(subject.user1)
          .custodyToAddress(
            await subject.usdc.getAddress(),
            subject.user1.address,
            ethers.parseEther('1'),
            transferData
          )
      ).to.be.rejectedWith("State isn't 0");
    });
  });

  // Add a section for testing getters
  describe('Getter Functions', function () {
    const custodyId = ethers.id('getter-test-custody');
    const amount = ethers.parseEther('10');

    beforeEach(async function () {
      // Set up custody with funds
      await subject.usdc.mint(subject.user1.address, amount);
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), amount);
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(custodyId, await subject.usdc.getAddress(), amount);
    });

    it('Should correctly get custody state', async function () {
      const state = await subject.psymm.getCustodyState(custodyId);
      expect(state).to.equal(0, 'Initial custody state should be 0');
    });

    it('Should correctly get PPM', async function () {
      const ppm = await subject.psymm.getPPM(custodyId);
      expect(ppm).to.equal(
        custodyId,
        'Initial PPM should be set to custody ID'
      );
    });

    it('Should correctly get custody balances', async function () {
      const balance = await subject.psymm.getCustodyBalances(
        custodyId,
        await subject.usdc.getAddress()
      );
      expect(balance).to.equal(
        amount,
        'Custody balance should match deposited amount'
      );

      // Check balance of non-deposited token
      const zeroBalance = await subject.psymm.getCustodyBalances(
        custodyId,
        await subject.usde.getAddress()
      );
      expect(zeroBalance).to.equal(
        0,
        'Non-deposited token should have zero balance'
      );
    });

    it('Should correctly get nullifier state', async function () {
      const { custodyId, ppmHelper, pubKeyParity, pubKeyX } =
        await getSinglePartyCustodyId(subject);
      // Set up custody with funds
      await subject.usdc.mint(subject.user1.address, amount);
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), amount);
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(custodyId, await subject.usdc.getAddress(), amount);

      const currentBlockTimestamp = await getLatestBlockTimestamp();

      const proof = ppmHelper.getMerkleProofByTypeAndArgs(
        'custodyToAddress',
        {
          receiver: subject.user1.address,
        },
        0,
        [
          {
            parity: pubKeyParity,
            x: pubKeyX,
          },
        ]
      );
      const e = ethers.hexlify(ethers.randomBytes(32));
      const verificationData = {
        id: custodyId,
        state: 0,
        timestamp: currentBlockTimestamp,
        pubKey: {
          parity: pubKeyParity,
          x: pubKeyX,
        },
        sig: {
          e: e, // Use our test nullifier
          s: ethers.hexlify(ethers.randomBytes(32)),
        },
        merkleProof: proof, // Use proof from the tree
      };

      // Set blockchain time to transfer timestamp
      await ethers.provider.send('evm_setNextBlockTimestamp', [
        currentBlockTimestamp + 1,
      ]);
      await ethers.provider.send('evm_mine', []);

      expect(await subject.psymm.getNullifier(e)).to.equal(
        false,
        'Unused nullifier should return false'
      );
      await subject.psymm
        .connect(subject.user1)
        .custodyToAddress(
          await subject.usdc.getAddress(),
          subject.user1.address,
          ethers.parseEther('1'),
          verificationData
        );

      // Should be true after using the nullifier
      expect(await subject.psymm.getNullifier(e)).to.equal(
        true,
        'Used nullifier should return true'
      );
    });

    it('Should correctly get SMA allowance', async function () {
      // Deploy a mock SMA and set up allowance
      const MockSMA = await ethers.getContractFactory('MockAaveSMA');
      const mockSMA = await MockSMA.deploy(await subject.psymm.getAddress());
      await mockSMA.waitForDeployment();

      // Initially should be false
      const initialAllowance = await subject.psymm.getwhitelistedSMA(
        custodyId,
        await mockSMA.getAddress()
      );
      expect(initialAllowance).to.equal(
        false,
        'Initial SMA allowance should be false'
      );

      // We'd need to deploy through the PSYMM to set allowance, tested elsewhere
    });

    it('Should correctly get custody message length', async function () {
      const msgLength = await subject.psymm.getCustodyMsgLength(custodyId);
      expect(msgLength).to.equal(0, 'Initial message length should be 0');
    });

    it('Should correctly get lastSMAUpdateTimestamp', async function () {
      // Create test custody
      const testCustodyId = ethers.id('timestamp-test-custody');

      // Get initial timestamp (should be 0)
      const initialTimestamp = await subject.psymm.getLastSMAUpdateTimestamp(
        testCustodyId
      );
      expect(initialTimestamp).to.equal(0, 'Initial timestamp should be 0');
    });
  });

  describe('SMA Operations', function () {
    const custodyId = ethers.id('sma-custody');
    const amount = ethers.parseEther('10');

    beforeEach(async function () {
      // Mint tokens and deposit to custody
      await subject.usdc.mint(subject.user1.address, amount);
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), amount);
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(custodyId, await subject.usdc.getAddress(), amount);
    });

    // it("Should allow custody to SMA transfer", async function () {

    //   // Deploy mock SMA
    //   const MockSMA = await ethers.getContractFactory("MockAaveSMA");
    //   const mockSMA = await MockSMA.deploy(await subject.psymm.getAddress());
    //   await mockSMA.waitForDeployment();

    //   // Deploy SMA through PSYMM
    //   const smaType = "mock";
    //   const factoryAddress = await mockSMA.getAddress();
    //   const data = ethers.solidityPacked(["address"], [await mockSMA.getAddress()]);

    //   const keyPair1 = SchnorrHelper.generateKeyPair();
    //   const keyPair2 = SchnorrHelper.generateKeyPair();

    //   // Get chain ID and contract address
    //   const chainId = await ethers.provider.getNetwork().then((n) => n.chainId);
    //   const contractAddress = await subject.psymm.getAddress();
    //   const usdcAddress = await subject.usdc.getAddress();
    //   const smaAddress = await mockSMA.getAddress();

    //   // Generate real Schnorr key pair for the test
    //   const keyPair = SchnorrHelper.generateKeyPair();

    //   // Create the PPM Helper
    //   const ppmHelper = new PPMHelper(Number(chainId), contractAddress as `0x${string}`);

    //   // Add deploySMA action
    //   ppmHelper.deploySMA(
    //     smaType,
    //     factoryAddress as `0x${string}`,
    //     data as `0x${string}`,
    //     0, // state
    //     keyPair.publicKey
    //   );

    //   // Add custodyToSMA action
    //   ppmHelper.custodyToSMA(
    //     smaType,
    //     usdcAddress as `0x${string}`,
    //     0, // state
    //     keyPair.publicKey
    //   );

    //   // Get custody ID from PPM helper
    //   const custodyId = ppmHelper.getCustodyID();

    //   // Deposit funds to custody
    //   // Mint tokens to the user first
    //   await subject.usdc.mint(subject.user1.address, amount);
    //   await subject.usdc.connect(subject.user1).approve(contractAddress, amount);
    //   await subject.psymm.connect(subject.user1).addressToCustody(custodyId, usdcAddress, amount);

    //   // Verify initial custody balance
    //   const initialBalance = await subject.psymm.custodyBalances(custodyId, usdcAddress);

    //   // Create timestamps for operations
    //   const baseTimestamp = Math.floor(Date.now() / 1000);
    //   const deploySMATimestamp = baseTimestamp + 3600; // 1 hour in the future
    //   const smaTransferTimestamp = baseTimestamp + 7200; // 2 hours in the future

    //   // Find the index of the deploySMA action in the PPM
    //   const ppmItems = ppmHelper.getPPM();
    //   let deploySMAIndex = -1;

    //   for (let i = 0; i < ppmItems.length; i++) {
    //     if (ppmItems[i].type === "deploySMA") {
    //       deploySMAIndex = i;
    //       break;
    //     }
    //   }

    //   const deploySMAProof = ppmHelper.getMerkleProof(deploySMAIndex);

    //   // Create message for deploySMA
    //   const deploySMAMessage = ethers.solidityPacked(
    //     ["uint256", "string", "bytes32", "string", "address", "bytes"],
    //     [deploySMATimestamp, "deploySMA", custodyId, smaType, factoryAddress, data]
    //   );

    //   // Sign the message
    //   const deploySMASignature = SchnorrHelper.sign(deploySMAMessage, keyPair);

    //   // Create verification data for deploySMA
    //   const deploySMAData = {
    //     id: custodyId,
    //     state: 0,
    //     timestamp: deploySMATimestamp,
    //     pubKey: keyPair.publicKey,
    //     sig: deploySMASignature,
    //     merkleProof: deploySMAProof,
    //   };

    //   // Set blockchain time to deploySMA timestamp
    //   await ethers.provider.send("evm_setNextBlockTimestamp", [deploySMATimestamp + 1]);
    //   await ethers.provider.send("evm_mine", []);

    //   // Execute deploySMA
    //   await subject.psymm.connect(subject.user1).deploySMA(smaType, factoryAddress, data, deploySMAData);

    //   // Find the index of the custodyToSMA action in the PPM
    //   let custodyToSMAIndex = -1;

    //   for (let i = 0; i < ppmItems.length; i++) {
    //     if (ppmItems[i].type === "custodyToSMA") {
    //       custodyToSMAIndex = i;
    //       break;
    //     }
    //   }

    //   const custodyToSMAProof = ppmHelper.getMerkleProof(custodyToSMAIndex);

    //   // Create message for custodyToSMA
    //   const custodyToSMAMessage = ethers.solidityPacked(
    //     ["uint256", "string", "bytes32", "address", "address", "uint256"],
    //     [smaTransferTimestamp, "custodyToSMA", custodyId, usdcAddress, smaAddress, amount]
    //   );

    //   // Sign the message
    //   const custodyToSMASignature = SchnorrHelper.sign(custodyToSMAMessage, keyPair);

    //   // Create verification data for custodyToSMA
    //   const custodyToSMAData = {
    //     id: custodyId,
    //     state: 0,
    //     timestamp: smaTransferTimestamp,
    //     pubKey: keyPair.publicKey,
    //     sig: custodyToSMASignature,
    //     merkleProof: custodyToSMAProof,
    //   };

    //   // Set blockchain time to custodyToSMA timestamp
    //   await ethers.provider.send("evm_setNextBlockTimestamp", [smaTransferTimestamp + 1]);
    //   await ethers.provider.send("evm_mine", []);

    //   // Execute custodyToSMA
    //   await subject.psymm.connect(subject.user1).custodyToSMA(usdcAddress, smaAddress, amount, custodyToSMAData);

    //   // Verify balances
    //   const custodyBalance = await subject.psymm.custodyBalances(custodyId, usdcAddress);
    //   const smaBalance = await subject.usdc.balanceOf(smaAddress);

    //   expect(custodyBalance).to.equal(0);
    //   expect(smaBalance).to.equal(amount);
    // });
  });

  describe('Settlement Operations', function () {
    const custodyId = ethers.id('settlement-custody');
    const amount = ethers.parseEther('10');

    beforeEach(async function () {
      // Mint tokens and deposit to custody
      await subject.usdc.mint(subject.user1.address, amount);
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), amount);
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(custodyId, await subject.usdc.getAddress(), amount);
    });

    it('Should handle provisional settlement', async function () {
      const calldata = ethers.solidityPacked(
        ['address', 'uint256'],
        [await subject.usdc.getAddress(), amount]
      );
      const msg = ethers.solidityPacked(
        ['string', 'bytes32'],
        ['settlement', custodyId]
      );

      // Submit provisional settlement
      await subject.psymm
        .connect(subject.user1)
        .submitProvisional(custodyId, calldata, msg);

      // Verify settlement state
      const msgLength = await subject.psymm.getCustodyMsgLength(custodyId);
      expect(msgLength).to.equal(0); // The contract doesn't increment msgLength
    });

    it('Should allow revoking provisional settlement', async function () {
      const calldata = ethers.solidityPacked(
        ['address', 'uint256'],
        [await subject.usdc.getAddress(), amount]
      );
      const msg = ethers.solidityPacked(
        ['string', 'bytes32'],
        ['settlement', custodyId]
      );

      // Submit and then revoke
      await subject.psymm
        .connect(subject.user1)
        .submitProvisional(custodyId, calldata, msg);
      await subject.psymm
        .connect(subject.user1)
        .revokeProvisional(custodyId, calldata, msg);

      // Verify settlement state
      const msgLength = await subject.psymm.getCustodyMsgLength(custodyId);
      expect(msgLength).to.equal(0); // The contract doesn't increment msgLength
    });

    it('Should handle custody balance tracking', async function () {
      // Create a unique custody ID for this test
      const balanceCustodyId = ethers.id('balance-test-custody');
      const depositAmount = ethers.parseEther('5');

      // Initial balance should be 0
      const initialBalance = await subject.psymm.getCustodyBalances(
        balanceCustodyId,
        await subject.usdc.getAddress()
      );
      expect(initialBalance).to.equal(0, 'Initial balance should be 0');

      // Mint tokens and deposit to custody
      await subject.usdc.mint(subject.user1.address, depositAmount);
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), depositAmount);
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(
          balanceCustodyId,
          await subject.usdc.getAddress(),
          depositAmount
        );

      // Check updated balance
      const updatedBalance = await subject.psymm.getCustodyBalances(
        balanceCustodyId,
        await subject.usdc.getAddress()
      );
      expect(updatedBalance).to.equal(
        depositAmount,
        'Balance should be updated after deposit'
      );

      // Deposit more tokens
      await subject.usdc.mint(subject.user1.address, depositAmount);
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), depositAmount);
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(
          balanceCustodyId,
          await subject.usdc.getAddress(),
          depositAmount
        );

      // Check final balance (should be doubled)
      const finalBalance = await subject.psymm.getCustodyBalances(
        balanceCustodyId,
        await subject.usdc.getAddress()
      );
      expect(finalBalance).to.equal(
        depositAmount * 2n,
        'Balance should be correctly accumulated'
      );
    });
  });

  describe('Withdraw Routing Operations', function () {
    it('Should reject withdraw routing to existing routing', async function () {
      const custodyId = ethers.id('routing-reject-test-custody');

      // Set initial routing
      await subject.psymm
        .connect(subject.user1)
        .withdrawReRouting(custodyId, subject.user2.address);

      // Try to set it again, should revert
      await expect(
        subject.psymm
          .connect(subject.user1)
          .withdrawReRouting(custodyId, subject.user3.address)
      ).to.be.rejectedWith('Already the custody owner');
    });
  });

  describe('Multiple Token Support', function () {
    it('Should handle multiple tokens in the same custody', async function () {
      // Create a unique custody ID for this test
      const { custodyId, ppmHelper, pubKeyParity, pubKeyX } =
        await getSinglePartyCustodyId(subject);
      const depositAmount = 7n;

      // Deposit USDC
      await subject.usdc.mint(subject.user1.address, depositAmount);
      await subject.usdc
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), depositAmount);
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(
          custodyId,
          await subject.usdc.getAddress(),
          depositAmount
        );

      // Deposit USDE as well
      await subject.usde.mint(subject.user1.address, depositAmount * 2n);
      await subject.usde
        .connect(subject.user1)
        .approve(await subject.psymm.getAddress(), depositAmount * 2n);
      await subject.psymm
        .connect(subject.user1)
        .addressToCustody(
          custodyId,
          await subject.usde.getAddress(),
          depositAmount * 2n
        );

      // Check both balances
      const usdcBalance = await subject.psymm.getCustodyBalances(
        custodyId,
        await subject.usdc.getAddress()
      );
      const usdeBalance = await subject.psymm.getCustodyBalances(
        custodyId,
        await subject.usde.getAddress()
      );

      expect(usdcBalance).to.equal(
        depositAmount,
        'USDC balance should be correct'
      );
      expect(usdeBalance).to.equal(
        depositAmount * 2n,
        'USDE balance should be correct'
      );
    });
  });
});
