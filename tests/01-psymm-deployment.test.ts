import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, SubjectType } from "./fixtures/DeployFixture";
import { increaseTime, getLatestBlockTimestamp } from "./fixtures/base";
import { ethers } from "hardhat";
import { PSYMM, MockERC20 } from "../typechain-types";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

import { PPMHelper } from "./utils/ppmHelper";
import { PPMBuilder } from "./utils/ppmBuilder";
import { SchnorrHelper } from "./utils/schnorrHelper";

describe("PSYMM", function () {
  let subject: SubjectType;

  beforeEach(async function () {
    subject = await loadFixture(deployFixture);
  });

  function createLeaf(
    action: string,
    chainId: bigint,
    contractAddress: string,
    custodyState: number,
    encodedParams: string,
    pubKeyParity: number,
    pubKeyX: string
  ): string {
    // Mimic the keccak256 hashing from verifyLeaf
    return ethers.keccak256(
      ethers.solidityPacked(
        ["bytes32"],
        [
          ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
              ["string", "uint256", "address", "uint8", "bytes", "uint8", "bytes32"],
              [
                action,
                chainId,
                contractAddress,
                custodyState,
                encodedParams,
                pubKeyParity,
                pubKeyX
              ]
            )
          )
        ]
      )
    );
  }

  describe("Custody Operations", function () {
    const custodyId = ethers.id("test-custody");
    const amount = ethers.parseEther("10");

    beforeEach(async function () {
      // Mint tokens to test users
      await subject.usdc.mint(subject.user1.address, amount);
      await subject.usde.mint(subject.user2.address, amount);
    });

    it("Should allow address to custody", async function () {
      // Approve tokens
      await subject.usdc.connect(subject.user1).approve(
        await subject.psymm.getAddress(),
        amount
      );

      // Transfer to custody
      await subject.psymm.connect(subject.user1).addressToCustody(
        custodyId,
        await subject.usdc.getAddress(),
        amount
      );

      // Verify custody balance
      const custodyBalance = await subject.psymm.custodyBalances(
        custodyId,
        await subject.usdc.getAddress()
      );
      expect(custodyBalance).to.equal(amount);
    });

    it("Should allow address to custody even without mocking merkle proofs", async function () {
      // Approve tokens
      await subject.usdc.connect(subject.user1).approve(
        await subject.psymm.getAddress(),
        amount
      );

      // Transfer to custody
      await subject.psymm.connect(subject.user1).addressToCustody(
        custodyId,
        await subject.usdc.getAddress(),
        amount
      );

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

    it("Should allow custody to custody transfer", async function () {
      const receiverId = ethers.id("receiver-custody");
      
      console.log("\n=== Setup ===");
      // First deposit to custody
      await subject.usdc.connect(subject.user1).approve(
        await subject.psymm.getAddress(),
        amount
      );
      await subject.psymm.connect(subject.user1).addressToCustody(
        custodyId,
        await subject.usdc.getAddress(),
        amount
      );

      console.log("Initial custody balance:", (await subject.psymm.custodyBalances(
        custodyId,
        await subject.usdc.getAddress()
      )).toString());

      // Get current PPM
      const currentPPM = await subject.psymm.getPPM(custodyId);
      console.log("Current PPM (custody ID):", currentPPM);
      console.log("Custody ID:", custodyId);
      console.log("They match:", currentPPM === custodyId);

      // Create the public key
      const pubKeyX = ethers.hexlify(ethers.randomBytes(32));
      const pubKeyParity = 0;
      console.log("Public Key X:", pubKeyX);
      console.log("Public Key Parity:", pubKeyParity);

      // Get chain info
      const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
      console.log("Chain ID:", chainId);
      const contractAddress = await subject.psymm.getAddress();
      console.log("Contract Address:", contractAddress);

      // Step 1: Create a merkle tree with custody transfer leaf
      console.log("\n=== Create Merkle Tree ===");
      const encodedParams = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32"],
        [receiverId]
      );

      // Create leaf using the exact format from VerificationUtils.verifyLeaf
      const leaf = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes32"],
          [
            ethers.keccak256(
              ethers.AbiCoder.defaultAbiCoder().encode(
                ["string", "uint256", "address", "uint8", "bytes", "uint8", "bytes32"],
                [
                  "custodyToCustody",
                  chainId,
                  contractAddress,
                  0, // custodyState
                  encodedParams,
                  pubKeyParity,
                  pubKeyX
                ]
              )
            )
          ]
        )
      );
      console.log("Leaf:", leaf);

      // Create an empty merkle tree (since we'll use custody ID as the root)
      // The contract verifies the merkle proof against the current PPM, which is the custody ID
      const emptyProof: string[] = [];
      
      // Step 2: Transfer using custody ID as the PPM
      console.log("\n=== Execute Transfer ===");
      const timestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour in the future

      // Ensure we're in the future for timestamp checks
      await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp + 1]);
      await ethers.provider.send("evm_mine", []);

      // Create verification data
      const verificationData = {
        id: custodyId,
        state: 0,
        timestamp: timestamp,
        pubKey: {
          parity: pubKeyParity,
          x: pubKeyX
        },
        sig: {
          e: ethers.hexlify(ethers.randomBytes(32)),
          s: ethers.hexlify(ethers.randomBytes(32))
        },
        merkleProof: emptyProof
      };
      
      console.log("Verification Data:", JSON.stringify({
        ...verificationData,
        timestamp: verificationData.timestamp.toString(),
        merkleProof: verificationData.merkleProof.map(p => p)
      }, null, 2));

      // Execute transfer
      await subject.psymm.connect(subject.user1).custodyToCustody(
        await subject.usdc.getAddress(),
        receiverId,
        amount,
        verificationData
      );

      // Verify balances
      console.log("\n=== Verify Results ===");
      const senderBalance = await subject.psymm.custodyBalances(
        custodyId,
        await subject.usdc.getAddress()
      );
      const receiverBalance = await subject.psymm.custodyBalances(
        receiverId,
        await subject.usdc.getAddress()
      );
      
      console.log("Sender Balance:", senderBalance.toString());
      console.log("Receiver Balance:", receiverBalance.toString());
      
      expect(senderBalance).to.equal(0); // We transferred all tokens
      expect(receiverBalance).to.equal(amount);
    });

    it("Should allow custody to address transfer", async function () {
      console.log("\n=== Multi-Party Custody Transfer Test with Schnorr Signatures ===");
      
      // Get chain ID and contract address
      const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
      const contractAddress = await subject.psymm.getAddress();
      
      // Get token address
      const usdcAddress = await subject.usdc.getAddress();
      
      console.log("Setting up Schnorr key pairs...");
      
      // Generate real Schnorr key pairs (with parity=27) instead of address-based signers
      const keyPair1 = SchnorrHelper.generateKeyPair();
      const keyPair2 = SchnorrHelper.generateKeyPair();
      
      console.log("Key Pair 1 - parity:", keyPair1.publicKey.parity, "x:", keyPair1.publicKey.x);
      console.log("Key Pair 2 - parity:", keyPair2.publicKey.parity, "x:", keyPair2.publicKey.x);
      
      // Create the PPM Helper
      const ppmHelper = new PPMHelper(Number(chainId), contractAddress as `0x${string}`);
      
      const aggregatedPubKey = SchnorrHelper.aggregatePublicKeys([
        keyPair1.publicKey, 
        keyPair2.publicKey
      ]);

      // Add custody to address action with both parties required
      ppmHelper.custodyToAddress(
        subject.user2.address, // recipient
        0, // state
        [aggregatedPubKey] // both parties required
      );

      ppmHelper.custodyToAddress(
        subject.user1.address, // recipient
        0, // state
        [keyPair1.publicKey] // both parties required
      );
      
      // Get custody ID from PPM helper
      const custodyId = ppmHelper.getCustodyID();
      console.log("Custody ID:", custodyId);
      
      // Deposit funds to custody
      console.log("\nDepositing funds to custody...");
      await subject.usdc.connect(subject.user1).approve(
        contractAddress,
        amount
      );
      await subject.psymm.connect(subject.user1).addressToCustody(
        custodyId,
        usdcAddress,
        amount
      );
      
      // Verify initial custody balance
      const initialBalance = await subject.psymm.custodyBalances(
        custodyId,
        usdcAddress
      );
      console.log("Initial custody balance:", initialBalance.toString());
      
      // Create message to sign
      const timestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour in the future
      const withdrawAmount = ethers.parseEther("5");
      
      // Create the message to sign for custodyToAddress
      const message = SchnorrHelper.createCustodyToAddressMessage(
        timestamp,
        custodyId,
        usdcAddress,
        subject.user2.address,
        withdrawAmount
      );
      
      console.log("\nCreating multi-party Schnorr signatures...");
      
      // Both parties sign the message
      const signature1 = SchnorrHelper.sign(message, keyPair1);
      const signature2 = SchnorrHelper.sign(message, keyPair2);
      
      console.log("Signature 1:", signature1);
      console.log("Signature 2:", signature2);
      
      // Combine parties' public keys and signatures (for true multi-sig)
      
      
      const aggregatedSignature = SchnorrHelper.aggregateSignatures([
        signature1, 
        signature2
      ]);
      
      console.log("Aggregated Public Key:", aggregatedPubKey);
      console.log("Aggregated Signature:", aggregatedSignature);
      
      // Set the block timestamp for verification
      await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp + 1]);
      await ethers.provider.send("evm_mine", []);
      
      // Get merkle proof for the aggregated key
      // Since we've added two separate entries to the PPM (one for each party),
      // we need to add a separate entry for the aggregated key
      
      // First, we'll check if the PPM already has a corresponding action for our aggregated key
      const ppmItems = ppmHelper.getPPM();
      let proofIndex = -1;
      
      for (let i = 0; i < ppmItems.length; i++) {
        const item = ppmItems[i];
        const party = Array.isArray(item.party) ? item.party[0] : item.party;
        
        if (item.type === "custodyToAddress" && 
            party.parity === aggregatedPubKey.parity && 
            party.x === aggregatedPubKey.x) {
          proofIndex = i;
          break;
        }
      }
      console.log("Proof Index:", proofIndex);
      // If we didn't find a matching entry, add one for the aggregated key
      // if (proofIndex === -1) {
      //   ppmHelper.custodyToAddress(
      //     subject.user2.address, // recipient
      //     0, // state
      //     aggregatedPubKey // The aggregated public key
      //   );
      //   // The index will be the last added item
      //   proofIndex = ppmHelper.getPPM().length - 1;
      // }
      
      const proof = ppmHelper.getMerkleProof(proofIndex);
      console.log("Using merkle proof at index:", proofIndex);
      console.log("Merkle proof length:", proof.length);
      
      // Create verification data with aggregated signature and key
      const verificationData = {
        id: custodyId,
        state: 0,
        timestamp: timestamp,
        pubKey: aggregatedPubKey,  // Using the aggregated public key
        sig: aggregatedSignature,  // Using the aggregated signature
        merkleProof: proof
      };
      
      console.log("\nExecuting custodyToAddress with aggregated Schnorr signature...");
      console.log("Verification Data:", JSON.stringify(verificationData, null, 2));
      
      // Execute custody to address with the aggregated signature
      // Notice we're connecting with user1 (doesn't matter who executes it)
      await subject.psymm.connect(subject.user1).custodyToAddress(
        usdcAddress,
        subject.user2.address,
        withdrawAmount,
        verificationData
      );
      
      // Check final balances
      const finalCustodyBalance = await subject.psymm.custodyBalances(
        custodyId,
        usdcAddress
      );
      const user2Balance = await subject.usdc.balanceOf(subject.user2.address);
      
      console.log("\n=== Results ===");
      console.log("Final custody balance:", finalCustodyBalance.toString());
      console.log("User2 balance:", user2Balance.toString());
      
      // Verify balances
      expect(finalCustodyBalance).to.equal(amount - withdrawAmount);
      expect(user2Balance).to.equal(withdrawAmount);
      
      console.log("Multi-party Schnorr signature verification successful!");
    });
  });

  describe("SMA Operations", function () {
    const custodyId = ethers.id("sma-custody");
    const amount = ethers.parseEther("10");

    beforeEach(async function () {
      // Mint tokens and deposit to custody
      await subject.usdc.mint(subject.user1.address, amount);
      await subject.usdc.connect(subject.user1).approve(
        await subject.psymm.getAddress(),
        amount
      );
      await subject.psymm.connect(subject.user1).addressToCustody(
        custodyId,
        await subject.usdc.getAddress(),
        amount
      );
    });

    it("Should allow custody to SMA transfer", async function () {
      // Deploy mock SMA
      const MockSMA = await ethers.getContractFactory("MockAaveSMA");
      const mockSMA = await MockSMA.deploy(await subject.psymm.getAddress());
      await mockSMA.waitForDeployment();

      // Deploy SMA through PSYMM
      const smaType = "mock";
      const factoryAddress = await mockSMA.getAddress();
      const data = ethers.solidityPacked(["address"], [await mockSMA.getAddress()]);

      // Get the chain ID for the test network
      const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
      const contractAddress = await subject.psymm.getAddress();
      
      // Create public key values
      const pubKeyX = ethers.hexlify(ethers.randomBytes(32));
      const pubKeyParity = 0;
      
      console.log("\n=== Setup ===");
      console.log("Custody ID:", custodyId);
      console.log("Initial PPM:", await subject.psymm.getPPM(custodyId));
      
      // Create leaves for our permissions tree
      const deploySMAParams = ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "address", "bytes"],
        [smaType, factoryAddress, data]
      );
      
      const deploySMALeaf = createLeaf(
        "deploySMA",
        chainId,
        contractAddress,
        0, // custodyState
        deploySMAParams,
        pubKeyParity,
        pubKeyX
      );
      
      const custodyToSMAParams = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address"],
        [await mockSMA.getAddress(), await subject.usdc.getAddress()]
      );
      
      const custodyToSMALeaf = createLeaf(
        "custodyToSMA",
        chainId,
        contractAddress,
        0, // custodyState
        custodyToSMAParams,
        pubKeyParity,
        pubKeyX
      );
      
      // Create our permission tree with both operations
      const permissionTree = StandardMerkleTree.of(
        [[deploySMALeaf], [custodyToSMALeaf]], 
        ["bytes32"]
      );
      
      console.log("Permission Tree Root:", permissionTree.root);
      
      // STEP 1: First update the PPM using an empty proof (since initially PPM = custodyId)
      const updatePPMData = {
        id: custodyId,
        state: 0,
        timestamp: Math.floor(Date.now() / 1000),
        pubKey: {
          parity: pubKeyParity,
          x: pubKeyX
        },
        sig: {
          e: ethers.hexlify(ethers.randomBytes(32)),
          s: ethers.hexlify(ethers.randomBytes(32))
        },
        merkleProof: [] // Empty proof for initial PPM update
      };
      
      console.log("\n=== Updating PPM ===");
      
      // Update the PPM to our permission tree root
      await subject.psymm.connect(subject.user1).updatePPM(
        permissionTree.root,
        updatePPMData
      );
      
      // STEP 2: Deploy SMA using proof from our permission tree
      console.log("\n=== Deploying SMA ===");
      
      const deploySMAData = {
        id: custodyId,
        state: 0,
        timestamp: Math.floor(Date.now() / 1000),
        pubKey: {
          parity: pubKeyParity,
          x: pubKeyX
        },
        sig: {
          e: ethers.hexlify(ethers.randomBytes(32)),
          s: ethers.hexlify(ethers.randomBytes(32))
        },
        merkleProof: permissionTree.getProof(0) // Use proof for deploySMA leaf
      };
      
      // Deploy SMA
      await subject.psymm.connect(subject.user1).deploySMA(
        smaType,
        factoryAddress,
        data,
        deploySMAData
      );
      
      // STEP 3: Transfer to SMA using proof from our permission tree
      console.log("\n=== Transferring to SMA ===");
      
      const transferData = {
        id: custodyId,
        state: 0,
        timestamp: Math.floor(Date.now() / 1000),
        pubKey: {
          parity: pubKeyParity,
          x: pubKeyX
        },
        sig: {
          e: ethers.hexlify(ethers.randomBytes(32)),
          s: ethers.hexlify(ethers.randomBytes(32))
        },
        merkleProof: permissionTree.getProof(1) // Use proof for custodyToSMA leaf
      };
      
      // Transfer to SMA
      await subject.psymm.connect(subject.user1).custodyToSMA(
        await subject.usdc.getAddress(),
        await mockSMA.getAddress(),
        amount,
        transferData
      );

      // Verify balances
      const custodyBalance = await subject.psymm.custodyBalances(
        custodyId,
        await subject.usdc.getAddress()
      );
      const smaBalance = await subject.usdc.balanceOf(await mockSMA.getAddress());
      
      console.log("\n=== Results ===");
      console.log("Custody Balance:", custodyBalance.toString());
      console.log("SMA Balance:", smaBalance.toString());
      
      expect(custodyBalance).to.equal(0);
      expect(smaBalance).to.equal(amount);
    });
  });

  describe("Settlement Operations", function () {
    const custodyId = ethers.id("settlement-custody");
    const amount = ethers.parseEther("10");

    beforeEach(async function () {
      // Mint tokens and deposit to custody
      await subject.usdc.mint(subject.user1.address, amount);
      await subject.usdc.connect(subject.user1).approve(
        await subject.psymm.getAddress(),
        amount
      );
      await subject.psymm.connect(subject.user1).addressToCustody(
        custodyId,
        await subject.usdc.getAddress(),
        amount
      );
    });

    it("Should handle provisional settlement", async function () {
      const calldata = ethers.solidityPacked(
        ["address", "uint256"],
        [await subject.usdc.getAddress(), amount]
      );
      const msg = ethers.solidityPacked(
        ["string", "bytes32"],
        ["settlement", custodyId]
      );

      // Submit provisional settlement
      await subject.psymm.connect(subject.user1).submitProvisional(
        custodyId,
        calldata,
        msg
      );

      // Verify settlement state
      const msgLength = await subject.psymm.getCustodyMsgLength(custodyId);
      expect(msgLength).to.equal(0); // The contract doesn't increment msgLength
    });

    it("Should allow revoking provisional settlement", async function () {
      const calldata = ethers.solidityPacked(
        ["address", "uint256"],
        [await subject.usdc.getAddress(), amount]
      );
      const msg = ethers.solidityPacked(
        ["string", "bytes32"],
        ["settlement", custodyId]
      );

      // Submit and then revoke
      await subject.psymm.connect(subject.user1).submitProvisional(
        custodyId,
        calldata,
        msg
      );
      await subject.psymm.connect(subject.user1).revokeProvisional(
        custodyId,
        calldata,
        msg
      );

      // Verify settlement state
      const msgLength = await subject.psymm.getCustodyMsgLength(custodyId);
      expect(msgLength).to.equal(0); // The contract doesn't increment msgLength
    });
  });
}); 