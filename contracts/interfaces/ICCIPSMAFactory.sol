// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ISMAFactory.sol";

interface ICCIPSMAFactory is ISMAFactory {
    function destinationChainAllowed(
        uint64 chainSelector
    ) external view returns (bool);
}
