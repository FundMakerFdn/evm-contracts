// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SettleMaker is ReentrancyGuard {

    mapping(uint256 => bytes32) public batchRoot;
    uint256 public batchNumber;

    function submitBatchRoot(bytes32 root, bytes calldata data) external {
        //TODO verify schnorr signature 
        batchRoot[batchNumber] = root;
        submitMerkleContent(batchNumber, data);
        batchNumber++;
    }

    ////////////////////////////////////////////////////////////////////
    // allowing anyone to post and read content of a merkle tree for all settlemaker ecosystem
    mapping(address => mapping(uint256 => bytes)) public merkleContent;

    function submitMerkleContent(uint256 batchNumber, bytes calldata content) external {
        merkleContent[msg.sender][batchNumber] = content;
    }

    function readMerkleContent(address sender, uint256 batchNumber) external view returns (bytes memory) {
        return merkleContent[sender][batchNumber];
    }

}