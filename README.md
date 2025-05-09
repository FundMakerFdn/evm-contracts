# PSYMM -> Across Integration

This project implements a secure custody and cross-chain bridge solution using PSYMM (Private Symmetric) and Across Protocol. The system allows for secure token custody and cross-chain transfers with privacy-preserving features.

## Overview

The system consists of two main components:

1. **PSYMM Contract**: A secure custody contract that manages token deposits and withdrawals with privacy features
2. **MockAcrossSMA**: A bridge adapter that integrates with Across Protocol's V3 SpokePool for cross-chain transfers

## Contract Addresses

### Arbitrum
- PSYMM: `0x06f15f5F613E414117A104CD1395af8C4F6347e6` 
- MockAcrossSMA: `0x213d0351489aFf4EBeE830eCcf27a4A7954Cce91`

### Base
- PSYMM: `0x4872936e50D695c86779c32Ad91b91aFbbeFC672`
- MockAcrossSMA: `0x0000000000000000000000000000000000000000` (TBD)

## Key Features

### PSYMM Contract
- Secure token custody management
- Privacy-preserving transfers using Schnorr signatures
- Merkle proof verification
- State management for custody operations
- Support for direct transfers and call-based transfers

### MockAcrossSMA
- Integration with Across Protocol's V3 SpokePool
- Support for cross-chain token transfers
- Configurable input/output tokens
- Chain-specific multicall handler support
- Secure token approval and transfer mechanisms

## Development

### Prerequisites
- Node.js
- Hardhat
- Solidity ^0.8.28

### Installation
```bash
npm install
```

### Testing
```bash
npx hardhat test
```

### Deployment
```bash
npx hardhat run scripts/03-deploy-arbi.ts --network arbitrum
npx hardhat run scripts/04-deploy-base.ts --network base

```

### Prod Testing
```bash
npx hardhat run scripts/05-prod-action --network arbitrum
```

## License
MIT


