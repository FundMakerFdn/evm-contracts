// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ISMAFactory.sol";

interface IUniswapV3SMAFactory is ISMAFactory {
    function routerAddress() external view returns (address);

    function pSymmAddress() external view returns (address);

    function tokenAllowed(address _token) external view returns (bool);

    function feeAllowed(uint24 _fee) external view returns (bool);

    function slippageLimitBps() external view returns (uint256);

    function maxDeadlineExtension() external view returns (uint256);
}
