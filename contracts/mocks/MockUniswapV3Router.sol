// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IUniswapV3Router.sol";

contract MockUniswapV3Router is IUniswapV3Router {
    using SafeERC20 for IERC20;

    // Exchange rate for mocks - this would simulate the price impact in a real pool
    // 1 Token A = exchangeRate[tokenA][tokenB] of Token B
    mapping(address => mapping(address => uint256)) public exchangeRates;

    // Events for tracking test interactions
    event ExactInputSingleExecuted(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event ExactInputExecuted(bytes path, uint256 amountIn, uint256 amountOut);
    event ExactOutputSingleExecuted(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event ExactOutputExecuted(bytes path, uint256 amountIn, uint256 amountOut);

    constructor() {}

    // Set exchange rates for testing
    function setExchangeRate(
        address tokenIn,
        address tokenOut,
        uint256 rate
    ) external {
        exchangeRates[tokenIn][tokenOut] = rate;
    }

    // Input: exact amount of token A, output: calculated amount of token B
    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable override returns (uint256 amountOut) {
        // Calculate output amount based on exchange rate and fee
        uint256 effectiveRate = exchangeRates[params.tokenIn][params.tokenOut];
        require(effectiveRate > 0, "Exchange rate not set");

        // Apply the fee (in basis points)
        uint256 fee = (params.amountIn * uint256(params.fee)) / 1_000_000; // fee is in millionths (e.g., 3000 = 0.3%)
        uint256 amountInAfterFee = params.amountIn - fee;

        // Calculate output amount
        amountOut = (amountInAfterFee * effectiveRate) / 1e18;

        // Ensure minimum output amount is met
        require(
            amountOut >= params.amountOutMinimum,
            "Insufficient output amount"
        );

        // Transfer tokens
        IERC20(params.tokenIn).safeTransferFrom(
            msg.sender,
            address(this),
            params.amountIn
        );
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);

        emit ExactInputSingleExecuted(
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            amountOut
        );

        return amountOut;
    }

    // Implement multi-hop swap
    function exactInput(
        ExactInputParams calldata params
    ) external payable override returns (uint256 amountOut) {
        // For simplicity in the mock, we'll only support path with one hop
        require(
            params.path.length >= 40,
            "Path must include at least two tokens"
        );

        // Extract first token and second token from the path
        address tokenIn = address(bytes20(params.path[:20]));
        address tokenOut = address(bytes20(params.path[23:43])); // Skip 3 bytes for the fee

        // Extract fee from path (next 3 bytes after first token)
        uint24 fee = uint24(uint8(params.path[20])) *
            65536 +
            uint24(uint8(params.path[21])) *
            256 +
            uint24(uint8(params.path[22]));

        // Calculate output amount using exactInputSingle logic
        uint256 effectiveRate = exchangeRates[tokenIn][tokenOut];
        require(effectiveRate > 0, "Exchange rate not set");

        // Apply the fee
        uint256 feeAmount = (params.amountIn * uint256(fee)) / 1_000_000;
        uint256 amountInAfterFee = params.amountIn - feeAmount;

        // Calculate output amount
        amountOut = (amountInAfterFee * effectiveRate) / 1e18;

        // Ensure minimum output amount is met
        require(
            amountOut >= params.amountOutMinimum,
            "Insufficient output amount"
        );

        // Transfer tokens
        IERC20(tokenIn).safeTransferFrom(
            msg.sender,
            address(this),
            params.amountIn
        );
        IERC20(tokenOut).safeTransfer(params.recipient, amountOut);

        emit ExactInputExecuted(params.path, params.amountIn, amountOut);

        return amountOut;
    }

    // Output: exact amount of token B, input: calculated amount of token A
    function exactOutputSingle(
        ExactOutputSingleParams calldata params
    ) external payable override returns (uint256 amountIn) {
        // Calculate required input amount based on exchange rate and fee
        uint256 effectiveRate = exchangeRates[params.tokenIn][params.tokenOut];
        require(effectiveRate > 0, "Exchange rate not set");

        // Calculate input amount before fee
        uint256 amountInBeforeFee = (params.amountOut * 1e18) / effectiveRate;

        // Apply the fee
        amountIn =
            amountInBeforeFee +
            (amountInBeforeFee * uint256(params.fee)) /
            (1_000_000 - uint256(params.fee));

        // Ensure maximum input amount is not exceeded
        require(
            amountIn <= params.amountInMaximum,
            "Excessive input amount required"
        );

        // Transfer tokens
        IERC20(params.tokenIn).safeTransferFrom(
            msg.sender,
            address(this),
            amountIn
        );
        IERC20(params.tokenOut).safeTransfer(
            params.recipient,
            params.amountOut
        );

        emit ExactOutputSingleExecuted(
            params.tokenIn,
            params.tokenOut,
            amountIn,
            params.amountOut
        );

        return amountIn;
    }

    // Implement multi-hop exact output swap
    function exactOutput(
        ExactOutputParams calldata params
    ) external payable override returns (uint256 amountIn) {
        // For simplicity, we'll only support a path with one hop
        require(
            params.path.length >= 40,
            "Path must include at least two tokens"
        );

        // For exact output, the path is reversed
        address tokenOut = address(bytes20(params.path[:20]));
        address tokenIn = address(bytes20(params.path[23:43])); // Skip 3 bytes for the fee

        // Extract fee from path (next 3 bytes after first token)
        uint24 fee = uint24(uint8(params.path[20])) *
            65536 +
            uint24(uint8(params.path[21])) *
            256 +
            uint24(uint8(params.path[22]));

        // Calculate required input using exactOutputSingle logic
        uint256 effectiveRate = exchangeRates[tokenIn][tokenOut];
        require(effectiveRate > 0, "Exchange rate not set");

        // Calculate input amount before fee
        uint256 amountInBeforeFee = (params.amountOut * 1e18) / effectiveRate;

        // Apply the fee
        amountIn =
            amountInBeforeFee +
            (amountInBeforeFee * uint256(fee)) /
            (1_000_000 - uint256(fee));

        // Ensure maximum input amount is not exceeded
        require(
            amountIn <= params.amountInMaximum,
            "Excessive input amount required"
        );

        // Transfer tokens
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(params.recipient, params.amountOut);

        emit ExactOutputExecuted(params.path, amountIn, params.amountOut);

        return amountIn;
    }
}
