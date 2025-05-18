// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../PSYMM/VerificationUtils.sol";

contract TestVerification {
    using VerificationUtils for bytes32;

    function verifyLeaf(
        bytes32 ppm,
        bytes32[] memory merkleProof,
        string memory action,
        uint256 chainId,
        address contractAddress,
        uint8 custodyState,
        bytes memory encodedParams,
        uint8 pubKeyParity,
        bytes32 pubKeyX
    ) public pure {
        VerificationUtils.verifyLeaf(
            ppm,
            merkleProof,
            action,
            chainId,
            contractAddress,
            custodyState,
            encodedParams,
            pubKeyParity,
            pubKeyX
        );
    }
}
