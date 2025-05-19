// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICCIPSMAFactory {
    function destinationChainAllowed(
        uint64 chainSelector
    ) external view returns (bool);

    function deploySMA(
        bytes32 custodyId,
        bytes calldata data,
        address _whitelistedCaller // TODO: Remove this after testing
    ) external returns (address);
}
