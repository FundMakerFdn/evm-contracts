import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture, SubjectType } from "./fixtures/DeployFixture";
import { increaseTime, getLatestBlockTimestamp } from "./fixtures/base";
import { ethers } from "hardhat";
import { PSYMM, MockERC20 } from "../typechain-types";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

import { PPMHelper } from "./utils/ppmHelper";
import { PPMBuilder } from "./utils/ppmBuilder";
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
      const ppmBuilder = new PPMBuilder();


      const chainId = await ethers.provider.getNetwork().then(n => n.chainId);
      const contractAddress = await subject.psymm.getAddress();

      const pubKeyX = ethers.hexlify(ethers.randomBytes(32));
      const pubKeyParity = 0;

      const ppmHelper = new PPMHelper(chainId, contractAddress);
      ppmHelper.custodyToAddress(subject.user2.address, 0, [
        {
          parity: pubKeyParity,
          x: pubKeyX
        },
      ]);

      // ppmBuilderV2.custodyToAddress(subject.user1.address, 0, [
      //   {
      //     parity: pubKeyParity,
      //     x: pubKeyX
      //   },
      // ]);

      console.log("Custody ID:", ppmHelper.getCustodyID());
      console.log("PPMs ID:", ppmHelper.getPPM());
      const proof = ppmHelper.getMerkleProof(0);

      console.log("Proof:", proof);
      const custodyId = ppmHelper.getCustodyID()

      // const addressEncodedParams = ethers.AbiCoder.defaultAbiCoder().encode(
      //   ["address"],
      //   [subject.user2.address]
      // );


    // ppmBuilder.addItem({
    //   type: "custodyToAddress",
    //   chainId: chainId,
    //   pSymm: contractAddress,
    //   state: 0,
    //   args: {
    //     receiver: subject.user2.address
    //   },
    //   party: [
    //     {
    //       parity: pubKeyParity,
    //       x: pubKeyX
    //     },
    //   ],
    // });

    // const custodyId = ppmBuilder.buildTreeRoot();

    console.log("Merkle root:", custodyId);

      // const ppm = ppmBuilder.addItem({
      //   type: "custodyToAddress",
      //   chainId: await ethers.provider.getNetwork().then(n => n.chainId),
      //   pSymm: await subject.psymm.getAddress(),
      //   state: 0,
      //   args: {
      //     receiver: subject.user2.address
      //   }
      // });

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
      
      
      // Create public key values
      // const pubKeyX = ethers.hexlify(ethers.randomBytes(32));
      // const pubKeyParity = 0;
      
      console.log("\n=== Setup ===");
      console.log("Custody ID:", custodyId);
      console.log("Initial PPM:", await subject.psymm.getPPM(custodyId));
      
      // STEP 1: The key insight - initially, PPM[custodyId] = custodyId
      // So the "leaf" we need to match is actually custodyId itself
      
      // Create a leaf for custodyToAddress permission
      
      
      // const addressLeaf = createLeaf(
      //   "custodyToAddress",
      //   chainId,
      //   contractAddress,
      //   0, // custodyState
      //   addressEncodedParams,
      //   pubKeyParity,
      //   pubKeyX
      // );
      
      // Create our permission tree with the real actions we want to authorize
      // const permissionTree = StandardMerkleTree.of([[addressLeaf]], ["bytes32"]);
      // const permissionRoot = permissionTree.root;
      
      // console.log("Permission Tree Root:", permissionRoot);
      
      // STEP 2: First, we need to use the trick from the custodyToCustody test
      // We use an empty merkle proof when PPM = custodyId
      
      // Create verification data for the initial updatePPM - with empty proof!
      // const bootstrapVerificationData = {
      //   id: custodyId,
      //   state: 0,
      //   timestamp: Math.floor(Date.now() / 1000),
      //   pubKey: {
      //     parity: pubKeyParity,
      //     x: pubKeyX
      //   },
      //   sig: {
      //     e: ethers.hexlify(ethers.randomBytes(32)),
      //     s: ethers.hexlify(ethers.randomBytes(32))
      //   },
      //   merkleProof: [] // Critical: Empty proof when using custodyId as the root
      // };
      
      console.log("\n=== Updating PPM ===");
      
      // Update the PPM to our permission tree root
      // await subject.psymm.connect(subject.user1).updatePPM(
      //   permissionRoot, // Set the PPM to our permission tree root
      //   bootstrapVerificationData
      // );
      
      // Verify PPM was updated correctly
      const updatedPPM = await subject.psymm.getPPM(custodyId);
      console.log("Updated PPM:", updatedPPM);
      // console.log("Expected PPM (permission root):", permissionRoot);
      // console.log("PPM set correctly:", updatedPPM === permissionRoot);

      // STEP 3: Now we can perform the actual transfer using our permissionTree proof
      console.log("\n=== Executing Transfer ===");
      
      // Create verification data for withdrawal - with proper Merkle proof
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
        merkleProof: proof // Use the proof from permission tree
      };
      
      console.log("Transfer Merkle Proof:", verificationData.merkleProof);

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
      
      console.log("\n=== Results ===");
      console.log("Custody Balance:", custodyBalance.toString());
      console.log("User Balance:", userBalance.toString());
      
      expect(custodyBalance).to.equal(amount - withdrawAmount);
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