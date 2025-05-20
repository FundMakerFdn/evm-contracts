import { PPMHelper, Party } from './PPMHelper';
import { Hex } from 'viem';

// Example usage of PPMBuilderV2

// Define a sample PPM address and chain ID
const ppmAddress =
  '0x1234567890123456789012345678901234567890' as `0x${string}`;
const chainId = 1; // Ethereum mainnet

// Create a new PPMBuilderV2 instance
const ppmHelper = new PPMHelper(chainId, ppmAddress);

// Define a party (would typically come from somewhere else)
const party: Party = {
  parity: 1,
  x: '0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' as Hex,
};

// Add some items
// 1. Deploy an SMA
const deployIndex = ppmHelper.deploySMA(
  'Test SMA',
  '0x2222222222222222222222222222222222222222' as `0x${string}`,
  '0x1234' as Hex,
  0, // state
  party
);

// 2. Call the SMA
const callIndex = ppmHelper.callSMA(
  'Test SMA',
  '0x3333333333333333333333333333333333333333' as `0x${string}`,
  {
    type: 'transfer(address,uint256)',
    args: ['0x4444444444444444444444444444444444444444', 1000000000000000000n], // 1 ETH
  },
  1, // state
  party
);

// 3. Custody to address
const custodyToAddressIndex = ppmHelper.custodyToAddress(
  '0x5555555555555555555555555555555555555555' as `0x${string}`,
  2, // state
  party
);

// Get the custody ID (merkle root)
const custodyId = ppmHelper.getCustodyID();
console.log('Custody ID (merkle root):', custodyId);

// Get merkle proof for the deploy action
const deployProof = ppmHelper.getMerkleProof(deployIndex);

// Get the merkle proof using the action details
const allItems = ppmHelper.getPPM();
const deployItem = allItems[deployIndex];
const deployProofAlt = ppmHelper.getMerkleProofByAction(deployItem);

// Get all actions with their proofs
const allActionsWithProofs = ppmHelper.getAllActionsWithProofs();
console.log(`Total actions: ${allActionsWithProofs.length}`);
