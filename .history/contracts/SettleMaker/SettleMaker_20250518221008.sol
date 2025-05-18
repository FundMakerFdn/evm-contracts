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
    /// Provisional Settlement WIP
    // @notice multiple provisional settlement can be emmited on the same custody, but only 1 need to not be revoked
    //          If more than 1 provisional settlement is live during vote phase, report vote
    //          If no proposal, dispute is considered on hold
    //          Submit and revoke are only considered if called by a validator
    //          Any user can propose a submit though discuss
    //          Solver who spam submit will be slashed by other SettleMaker validators
    function submitProvisional(bytes32 _id, bytes calldata _calldata, bytes calldata _msg) external { emit submitProvisionalEvent(_id, _calldata, _msg);}
    function revokeProvisional(bytes32 _id, bytes calldata _calldata, bytes calldata _msg) external { emit revokeProvisionalEvent(_id, _calldata, _msg);}
    function discussProvisional(bytes32 _id, bytes calldata _msg) external { emit discussProvisionalEvent(_id, _msg);}  // submit arweave merkle leaves here
    
    // PSYMM custody state change, if state change to 1, SettleMaker validator will check submissions here. 
    // Subi

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