// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/ISettlement.sol";
import "./interfaces/ISettleMaker.sol";
import "./interfaces/IEditSettlement.sol";
import "./interfaces/IValidatorSettlement.sol";
import "./interfaces/IBatchMetadataSettlement.sol";
import "./interfaces/IUnresolvedListSettlement.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract SettleMaker is ISettleMaker, ReentrancyGuard {

    mapping(uint256 => bytes32) public batchRoot;
    

    function submitBatchRoot(uint256 batchNumber, bytes32 root) external {
        batchRoot[batchNumber] = root;
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