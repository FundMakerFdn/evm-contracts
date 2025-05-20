// Index.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ISMAFactory.sol";

interface IAcrossSMAFactory is ISMAFactory {
    function inputTokenAllowed(address _token) external view returns (bool);

    function outputTokenAllowed(address _token) external view returns (bool);

    function targetChainMulticallHandler(
        uint256 _chainId
    ) external view returns (address);

    function pSymmAddress() external view returns (address);
}
