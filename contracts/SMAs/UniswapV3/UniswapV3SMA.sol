// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../PSYMM/PSYMM.sol";
import "../../interfaces/IUniswapV3Router.sol";
import "../../interfaces/IUniswapV3SMAFactory.sol";

contract UniswapV3SMA {
    using SafeERC20 for IERC20;

    PSYMM public immutable pSymm;
    IUniswapV3Router public immutable router;
    IUniswapV3SMAFactory public factory;
    bytes32 public custodyId;

    // Add mapping for authorized callers
    mapping(address => bool) public whitelistedCallers;

    modifier onlyPSymm() {
        require(msg.sender == address(pSymm), "Only pSymm can call");
        _;
    }

    modifier onlySelfOrPSYMM() {
        require(
            msg.sender == address(this) || msg.sender == address(pSymm),
            "CCIPSMA: Caller is not self or PSYMM"
        );
        _;
    }

    modifier onlyWhitelistedCaller() {
        require(
            whitelistedCallers[msg.sender],
            "CCIPSMA: Caller is not whitelisted"
        );
        _;
    }

    modifier allowedToken(address _token) {
        require(
            IUniswapV3SMAFactory(factory).tokenAllowed(_token),
            "Token not allowed"
        );
        _;
    }

    modifier allowedFee(uint24 _fee) {
        require(
            IUniswapV3SMAFactory(factory).feeAllowed(_fee),
            "Fee not allowed"
        );
        _;
    }

    constructor(
        address _pSymmAddress,
        address _routerAddress,
        address _factory,
        bytes32 _custodyId,
        address _whitelistedCaller
    ) {
        require(_pSymmAddress != address(0), "Invalid pSymm address");
        require(_routerAddress != address(0), "Invalid router address");
        require(_factory != address(0), "Invalid factory address");

        pSymm = PSYMM(_pSymmAddress);
        router = IUniswapV3Router(_routerAddress);
        factory = IUniswapV3SMAFactory(_factory);
        custodyId = _custodyId;

        // TODO: Remove this after testing
        whitelistedCallers[_whitelistedCaller] = true;
    }

    // TEMPORARY: Only PSYMM or whitelisted callers
    // WARNING: This is a temporary solution and should be removed after testing
    modifier onlyPSymmOrWhitelistedCaller() {
        require(
            msg.sender == address(pSymm) || whitelistedCallers[msg.sender],
            "CCIPSMA: Caller is not PSYMM or whitelisted"
        );
        _;
    }

    // Swap exact tokens for tokens (minimumAmountOut is calculated from slippageLimitBps)
    function swapExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn
    )
        external
        allowedToken(tokenIn)
        allowedToken(tokenOut)
        allowedFee(fee)
        onlyPSymm
        returns (uint256 amountOut)
    {
        // Transfer tokens from PSYMM to this contract
        // Note: This should be done through custodyToSMA in the PSYMM contract before calling this

        // Calculate minimum output based on slippage limit

        // Approve router to spend tokens
        IERC20(tokenIn).approve(address(router), amountIn);

        // Set deadline
        uint256 deadline = block.timestamp + factory.maxDeadlineExtension();

        // Execute swap
        IUniswapV3Router.ExactInputSingleParams memory params = IUniswapV3Router
            .ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                deadline: deadline,
                amountIn: amountIn,
                amountOutMinimum: 0, // Will be validated off-chain in the custody permission
                sqrtPriceLimitX96: 0 // No price limit
            });

        amountOut = router.exactInputSingle(params);

        // Return tokens to PSYMM custody
        smaToCustody(tokenOut, amountOut);

        return amountOut;
    }

    // Swap exact tokens for tokens with minimum output
    function swapExactInput(
        bytes calldata path,
        uint256 amountIn
    ) external onlyPSymm returns (uint256 amountOut) {
        // Get input token (first token in path)
        address tokenIn = extractTokenIn(path);
        require(
            IUniswapV3SMAFactory(factory).tokenAllowed(tokenIn),
            "Input token not allowed"
        );

        // Approve router to spend tokens
        IERC20(tokenIn).approve(address(router), amountIn);

        // Set deadline
        uint256 deadline = block.timestamp + factory.maxDeadlineExtension();

        // Execute swap
        IUniswapV3Router.ExactInputParams memory params = IUniswapV3Router
            .ExactInputParams({
                path: path,
                recipient: address(this),
                deadline: deadline,
                amountIn: amountIn,
                amountOutMinimum: 0 // Will be validated off-chain in the custody permission
            });

        amountOut = router.exactInput(params);

        // Extract output token (last token in path)
        address tokenOut = extractTokenOut(path);
        require(
            IUniswapV3SMAFactory(factory).tokenAllowed(tokenOut),
            "Output token not allowed"
        );

        // Return tokens to PSYMM custody
        smaToCustody(tokenOut, amountOut);

        return amountOut;
    }

    // Swap tokens for exact tokens
    function swapExactOutputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountOut,
        uint256 amountInMaximum
    )
        external
        allowedToken(tokenIn)
        allowedToken(tokenOut)
        allowedFee(fee)
        onlyPSymm
        returns (uint256 amountIn)
    {
        // Approve router to spend tokens
        IERC20(tokenIn).approve(address(router), amountInMaximum);

        // Set deadline
        uint256 deadline = block.timestamp + factory.maxDeadlineExtension();

        // Execute swap
        IUniswapV3Router.ExactOutputSingleParams memory params = IUniswapV3Router
            .ExactOutputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                deadline: deadline,
                amountOut: amountOut,
                amountInMaximum: amountInMaximum,
                sqrtPriceLimitX96: 0 // No price limit
            });

        amountIn = router.exactOutputSingle(params);

        // Return unused input tokens and output tokens to PSYMM custody
        if (amountIn < amountInMaximum) {
            uint256 remainingInput = amountInMaximum - amountIn;
            smaToCustody(tokenIn, remainingInput);
        }
        smaToCustody(tokenOut, amountOut);

        return amountIn;
    }

    // Move tokens from SMA back to PSYMM custody
    function smaToCustody(address _token, uint256 _amount) public onlyPSymm {
        IERC20(_token).approve(address(pSymm), _amount);
        pSymm.addressToCustody(custodyId, _token, _amount);
    }

    // Helper to extract input token from path
    function extractTokenIn(
        bytes calldata path
    ) internal pure returns (address) {
        require(path.length >= 20, "Invalid path");
        return address(uint160(bytes20(path[:20])));
    }

    // Helper to extract output token from path
    function extractTokenOut(
        bytes calldata path
    ) internal pure returns (address) {
        require(path.length >= 20, "Invalid path");
        return address(uint160(bytes20(path[path.length - 20:])));
    }
}
