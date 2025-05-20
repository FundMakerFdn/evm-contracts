// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../PSYMM/PSYMM.sol";
import "./UniswapV3SMA.sol";
import "./IUniswapV3SMAFactory.sol";

import "hardhat/console.sol";

contract UniswapV3SMAFactory is IUniswapV3SMAFactory {
    event UniswapV3SMADeployed(
        address indexed smaAddress,
        bytes32 indexed custodyId
    );

    address public immutable override pSymmAddress;
    address public immutable override routerAddress;

    // Security settings
    mapping(address => bool) public override tokenAllowed;
    mapping(uint24 => bool) public override feeAllowed;
    uint256 public override slippageLimitBps = 50; // 0.5% default slippage limit
    uint256 public override maxDeadlineExtension = 1 hours; // 1 hour default deadline extension

    constructor(address _pSymmAddress, address _routerAddress) {
        require(_pSymmAddress != address(0), "Invalid pSymm address");
        require(_routerAddress != address(0), "Invalid router address");
        pSymmAddress = _pSymmAddress;
        routerAddress = _routerAddress;
    }

    modifier onlyPSymm() {
        require(msg.sender == pSymmAddress, "Only pSymm can call");
        _;
    }

    /*
     * @param custodyId: The custody ID of the SMA
     * @param data: Currently it is only used custodyId
     * @param _whitelistedCaller: Address of the whitelisted caller other than pSymm
     * @warning `data` might be used for other purposes in the future
     * @dev TODO: Remove `_whitelistedCaller` after testing
     * @dev TODO: Validate the logic of extracting custodyId from the data
     */
    function deploySMA(
        bytes32 custodyId,
        bytes calldata data,
        address _whitelistedCaller
    ) external onlyPSymm returns (address) {
        // Extract custodyId from the data
        require(data.length >= 32, "Data too short for custodyId");

        // TODO: Validate the logic of extracting custodyId from the data
        // bytes32 custodyId;
        // assembly {
        //     custodyId := calldataload(data.offset)
        // }

        // Deploy a new UniswapV3SMA
        UniswapV3SMA sma = new UniswapV3SMA(
            pSymmAddress,
            routerAddress,
            address(this),
            custodyId,
            _whitelistedCaller
        );

        emit UniswapV3SMADeployed(address(sma), custodyId);
        return address(sma);
    }

    // Admin functions to configure allowed tokens and fees
    function setTokenAllowed(address _token, bool _allowed) external {
        tokenAllowed[_token] = _allowed;
    }

    function setFeeAllowed(uint24 _fee, bool _allowed) external {
        feeAllowed[_fee] = _allowed;
    }

    function setSlippageLimitBps(uint256 _slippageLimitBps) external {
        require(
            _slippageLimitBps <= 10000,
            "Slippage limit cannot exceed 100%"
        );
        slippageLimitBps = _slippageLimitBps;
    }

    function setMaxDeadlineExtension(uint256 _maxDeadlineExtension) external {
        require(
            _maxDeadlineExtension <= 24 hours,
            "Max deadline extension cannot exceed 24 hours"
        );
        maxDeadlineExtension = _maxDeadlineExtension;
    }
}
