// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICCIPSMAFactory {
    function destinationChainAllowed(uint64 chainSelector) external view returns (bool);
    function deploySMA(bytes calldata data) external returns (address);
} 