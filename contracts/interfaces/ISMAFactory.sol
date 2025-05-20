// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISMAFactory {
    function deploySMA(
        bytes32 custodyId,
        bytes calldata data,
        address _whitelistedCaller // TODO: Remove this after testing
    ) external returns (address);
}
