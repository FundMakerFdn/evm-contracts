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

    mapping(bytes32 => bytes) public custodyRules;
    mapping(uint => bytes)


}