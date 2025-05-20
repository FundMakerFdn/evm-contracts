// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IUniswapV3SMAFactory {
    function routerAddress() external view returns (address);

    function pSymmAddress() external view returns (address);

    function tokenAllowed(address _token) external view returns (bool);

    function feeAllowed(uint24 _fee) external view returns (bool);

    function slippageLimitBps() external view returns (uint256);

    function maxDeadlineExtension() external view returns (uint256);

    function deploySMA(
        bytes32 custodyId,
        bytes calldata data,
        address _whitelistedCaller // TODO: Remove this after testing
    ) external returns (address);
}
