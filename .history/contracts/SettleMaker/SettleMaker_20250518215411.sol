// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;


// Basic SettleMaker for tests without governance
contract SettleMaker {

    mapping(uint256 => bytes32) public batchRoot;
    uint256 public batchNumber;

    function submitBatchRoot(bytes32 root, bytes calldata data) external {
        //TODO verify schnorr signature 
        batchRoot[batchNumber] = root;
        submitMerkleContent(batchNumber, data);
        batchNumber++;
    }

    // Governance
    // TODO FROST schnorr, add, remove signers
    // TODO set next batch votes

    ////////////////////////////////////////////////////////////////////
    // allowing anyone to post and read content of a merkle tree for all settlemaker ecosystem

    ////////////////////////////////////////////////////////////////////
    // allowing anyone to post and read content of a merkle tree for all settlemaker ecosystem
    mapping(address => mapping(uint256 => bytes)) public merkleContent;
    mapping(address => uint256) public merkleContentCount;

    function submitMerkleContent(uint256 batchNumber, bytes calldata content) external {
        merkleContent[msg.sender][batchNumber] = content;
        merkleContentCount[msg.sender]++;
    }

    function readMerkleContent(address sender, uint256 batchNumber) external view returns (bytes memory) {
        return merkleContent[sender][batchNumber];
    }

}