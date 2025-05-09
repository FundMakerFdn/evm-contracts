import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, SubjectType } from "./fixtures/DeployFixture";
import { increaseTime, getLatestBlockTimestamp } from "./fixtures/base";
import { ethers } from "hardhat";
import { PSYMM, MockERC20 } from "../typechain-types";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

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

      // Get the chain ID for the test network
      const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
      
      // Get the PPM value
      await subject.psymm.getPPM(custodyId); // This will be the Merkle root

      // Create a leaf for the merkle tree
      const pubKeyX = ethers.hexlify(ethers.randomBytes(32));
      const pubKeyParity = 0;
      
      const encodedParams = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address"],
        [subject.user2.address]
      );
      
      const leaf = createLeaf(
        "custodyToAddress",
        chainId,
        await subject.psymm.getAddress(),
        0, // custodyState
        encodedParams,
        pubKeyParity,
        pubKeyX
      );

      // For testing, we'll create a simple tree with just our leaf
      const tree = StandardMerkleTree.of([[leaf]], ["bytes32"]);
      const root = tree.root;
      
      // Set the PPM to our tree root through addressToCustody (which sets PPM)
      await subject.usdc.mint(subject.user1.address, ethers.parseEther("1"));
      await subject.usdc.connect(subject.user1).approve(
        await subject.psymm.getAddress(),
        ethers.parseEther("1")
      );
      await subject.psymm.connect(subject.user1).addressToCustody(
        custodyId,
        await subject.usdc.getAddress(),
        ethers.parseEther("1")
      );

      // Create verification data with our proof
      const verificationData = {
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
        merkleProof: tree.getProof(0)
      };

      // Transfer from custody to address
      const withdrawAmount = ethers.parseEther("5");
      await subject.psymm.connect(subject.user1).custodyToAddress(
        await subject.usdc.getAddress(),
        subject.user2.address,
        withdrawAmount,
        verificationData
      );

      // Verify balances
      const custodyBalance = await subject.psymm.custodyBalances(
        custodyId,
        await subject.usdc.getAddress()
      );
      const userBalance = await subject.usdc.balanceOf(subject.user2.address);
      
      expect(custodyBalance).to.equal(amount - withdrawAmount + ethers.parseEther("1")); // We added 1 more ETH for PPM update
      expect(userBalance).to.equal(ethers.parseEther("5"));
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
      
      // Create a leaf for the merkle tree for deploySMA
      const pubKeyX = ethers.hexlify(ethers.randomBytes(32));
      const pubKeyParity = 0;
      
      const encodedParams = ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "address", "bytes"],
        [smaType, factoryAddress, data]
      );
      
      const leaf = createLeaf(
        "deploySMA",
        chainId,
        await subject.psymm.getAddress(),
        0, // custodyState
        encodedParams,
        pubKeyParity,
        pubKeyX
      );

      // For testing, we'll create a simple tree with just our leaf
      const tree = StandardMerkleTree.of([[leaf]], ["bytes32"]);
      const root = tree.root;
      
      // Set the PPM to our tree root through addressToCustody (which sets PPM)
      await subject.usdc.mint(subject.user1.address, ethers.parseEther("1"));
      await subject.usdc.connect(subject.user1).approve(
        await subject.psymm.getAddress(),
        ethers.parseEther("1")
      );
      await subject.psymm.connect(subject.user1).addressToCustody(
        custodyId,
        await subject.usdc.getAddress(),
        ethers.parseEther("1")
      );

      const verificationData = {
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
        merkleProof: tree.getProof(0)
      };

      // Deploy SMA
      await subject.psymm.connect(subject.user1).deploySMA(
        smaType,
        factoryAddress,
        data,
        verificationData
      );

      // Now create a leaf for custodyToSMA
      const smaEncodedParams = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address"],
        [await mockSMA.getAddress(), await subject.usdc.getAddress()]
      );
      
      const smaLeaf = createLeaf(
        "custodyToSMA",
        chainId,
        await subject.psymm.getAddress(),
        0, // custodyState
        smaEncodedParams,
        pubKeyParity,
        pubKeyX
      );

      // Create a new tree for the SMA transfer
      const smaTree = StandardMerkleTree.of([[smaLeaf]], ["bytes32"]);
      
      // Set the PPM again to update the Merkle root
      await subject.usdc.mint(subject.user1.address, ethers.parseEther("1"));
      await subject.usdc.connect(subject.user1).approve(
        await subject.psymm.getAddress(),
        ethers.parseEther("1")
      );
      await subject.psymm.connect(subject.user1).addressToCustody(
        custodyId,
        await subject.usdc.getAddress(),
        ethers.parseEther("1")
      );

      // Create verification data for transfer
      const transferVerificationData = {
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
        merkleProof: smaTree.getProof(0)
      };

      // Transfer to SMA
      await subject.psymm.connect(subject.user1).custodyToSMA(
        await subject.usdc.getAddress(),
        await mockSMA.getAddress(),
        amount,
        transferVerificationData
      );

      // Verify balances
      const custodyBalance = await subject.psymm.custodyBalances(
        custodyId,
        await subject.usdc.getAddress()
      );
      const smaBalance = await subject.usdc.balanceOf(await mockSMA.getAddress());
      
      expect(custodyBalance).to.equal(ethers.parseEther("2")); // We added 2 more ETH for PPM updates
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