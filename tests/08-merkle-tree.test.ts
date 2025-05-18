import { expect } from 'chai';
import { ethers } from 'hardhat';
import { PPMHelper } from './utils/PPMHelper';
import { hexlify, randomBytes } from 'ethers';

describe('Merkle Tree Tests', function () {
  let ppmHelper: PPMHelper;
  let chainId: bigint;
  let pSymmAddress: string;
  let testVerification: any;

  before(async function () {
    chainId = await ethers.provider.getNetwork().then((n) => n.chainId);
    // Deploy PSYMM contract to get a real address
    const PSYMMFactory = await ethers.getContractFactory('PSYMM');
    const psymm = await PSYMMFactory.deploy();
    pSymmAddress = await psymm.getAddress();

    // Deploy TestVerification contract
    const TestVerificationFactory = await ethers.getContractFactory(
      'TestVerification'
    );
    testVerification = await TestVerificationFactory.deploy();
    await testVerification.waitForDeployment();

    // Initialize PPMHelper
    ppmHelper = new PPMHelper(Number(chainId), pSymmAddress as `0x${string}`);
  });

  it('should create a tree with multiple leaves and verify all proofs', async function () {
    // Create multiple random public keys for different actions
    const publicKeys = Array.from({ length: 5 }, () => ({
      parity: 0,
      x: hexlify(randomBytes(32)) as `0x${string}`,
    }));

    // Add different types of actions to the tree
    const actionIndices: number[] = [];

    // 1. Add deploySMA action
    actionIndices.push(
      ppmHelper.deploySMA(
        'TestSMA',
        hexlify(randomBytes(20)) as `0x${string}`,
        '0x' as `0x${string}`,
        0,
        publicKeys[0]
      )
    );

    // 2. Add custodyToAddress action
    actionIndices.push(
      ppmHelper.custodyToAddress(
        hexlify(randomBytes(20)) as `0x${string}`,
        0,
        publicKeys[1]
      )
    );

    // 3. Add updatePPM action
    actionIndices.push(ppmHelper.updatePPM(0, publicKeys[2]));

    // 4. Add custodyToCustody action
    actionIndices.push(
      ppmHelper.custodyToCustody(hexlify(randomBytes(32)), 0, publicKeys[3])
    );

    // 5. Add changeCustodyState action
    actionIndices.push(ppmHelper.changeCustodyState(1, 0, publicKeys[4]));

    // Get the root
    const root = ppmHelper.getCustodyID();

    // Verify each leaf's proof
    for (let i = 0; i < actionIndices.length; i++) {
      const proof = ppmHelper.getMerkleProof(actionIndices[i]);
      const item = ppmHelper.getPPM()[actionIndices[i]];
      const party = Array.isArray(item.party) ? item.party[0] : item.party;

      // Verify using TestVerification contract
      await expect(
        testVerification.verifyLeaf(
          root,
          proof,
          item.type,
          chainId,
          pSymmAddress,
          item.state,
          item.args,
          party.parity,
          party.x
        )
      ).to.not.be.reverted;

      console.log(`Verified proof for action type: ${item.type}`);
    }
  });

  it('should handle a single leaf tree correctly', async function () {
    // Clear previous items
    ppmHelper.clear();

    // Add just one action
    const publicKey = {
      parity: 0,
      x: hexlify(randomBytes(32)) as `0x${string}`,
    };

    const actionIndex = ppmHelper.updatePPM(0, publicKey);
    const root = ppmHelper.getCustodyID();
    const proof = ppmHelper.getMerkleProof(actionIndex);

    // For a single leaf, the proof should be empty
    expect(proof).to.be.empty;

    const item = ppmHelper.getPPM()[actionIndex];
    const party = Array.isArray(item.party) ? item.party[0] : item.party;

    // Verify using TestVerification contract
    await expect(
      testVerification.verifyLeaf(
        root,
        proof,
        item.type,
        chainId,
        pSymmAddress,
        item.state,
        item.args,
        party.parity,
        party.x
      )
    ).to.not.be.reverted;
  });

  it('should fail verification with incorrect proof', async function () {
    // Clear previous items
    ppmHelper.clear();

    // Add two actions
    const publicKeys = Array.from({ length: 2 }, () => ({
      parity: 0,
      x: hexlify(randomBytes(32)) as `0x${string}`,
    }));

    const actionIndex1 = ppmHelper.updatePPM(0, publicKeys[0]);
    const actionIndex2 = ppmHelper.custodyToAddress(
      hexlify(randomBytes(20)) as `0x${string}`,
      0,
      publicKeys[1]
    );

    const root = ppmHelper.getCustodyID();

    // Get proof for first action
    const proof = ppmHelper.getMerkleProof(actionIndex1);

    // But try to verify it against the second action's leaf
    const item2 = ppmHelper.getPPM()[actionIndex2];
    const party2 = Array.isArray(item2.party) ? item2.party[0] : item2.party;

    // Verify using TestVerification contract - should revert
    await expect(
      testVerification.verifyLeaf(
        root,
        proof,
        item2.type,
        chainId,
        pSymmAddress,
        item2.state,
        item2.args,
        party2.parity,
        party2.x
      )
    ).to.be.revertedWith('Invalid merkle proof');
  });
});
