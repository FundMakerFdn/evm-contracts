// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../interfaces/V3SpokePoolInterface.sol";
import "../../interfaces/IAcrossSMAFactory.sol";
import "../../PSYMM/PSYMM.sol";
using SafeERC20 for IERC20;

contract AcrossSMA {
    PSYMM public immutable pSymm;
    V3SpokePoolInterface public spokePool;
    IAcrossSMAFactory public factory;
    bytes32 public custodyId;

    // Whitelist authorized callers
    mapping(address => bool) public whitelistedCaller;

    modifier onlyPSymm() {
        require(msg.sender == address(pSymm), "Only pSymm can call");
        _;
    }

    modifier onlyWhitelistedCaller() {
        require(
            whitelistedCaller[msg.sender],
            "Only whitelisted caller can call"
        );
        _;
    }

    modifier onlyPSymmOrWhitelistedCaller() {
        require(
            msg.sender == address(pSymm) || whitelistedCaller[msg.sender],
            "Only pSymm or whitelisted caller can call"
        );
        _;
    }

    modifier allowedInputToken(address _token) {
        require(
            IAcrossSMAFactory(factory).inputTokenAllowed(_token),
            "Input token not allowed"
        );
        _;
    }

    modifier allowedOutputToken(address _token) {
        require(
            IAcrossSMAFactory(factory).outputTokenAllowed(_token),
            "Output token not allowed"
        );
        _;
    }

    modifier allowedTargetChain(uint256 _chainId) {
        require(
            IAcrossSMAFactory(factory).targetChainMulticallHandler(_chainId) !=
                address(0),
            "Target chain not allowed"
        );
        _;
    }

    // TODO: Accept AaveSMA params in constructor
    constructor(
        address _pSymmAddress,
        address _spokePoolAddress,
        address _factory,
        bytes32 _custodyId,
        address _whitelistedCaller // TODO: Remove this after testing
    ) {
        require(_pSymmAddress != address(0), "Invalid pSymm address");
        pSymm = PSYMM(_pSymmAddress);
        spokePool = V3SpokePoolInterface(_spokePoolAddress);
        factory = IAcrossSMAFactory(_factory);
        custodyId = _custodyId;

        // TODO: Remove this after testing
        whitelistedCaller[_whitelistedCaller] = true;
    }

    function setWhitelistedCaller(address _caller, bool _allowed) external onlyPSymmOrWhitelistedCaller {
        whitelistedCaller[_caller] = _allowed;
    }

    function deposit(
        uint256 _destinationChainId,
        address _inputToken,
        address _outputToken,
        uint256 _amount,
        uint256 _minAmount,
        bytes calldata _message
    )
        external
        allowedInputToken(_inputToken)
        allowedOutputToken(_outputToken)
        allowedTargetChain(_destinationChainId)
        onlyPSymm
    {
        // deposit amount of token
        IERC20(_inputToken).approve(address(spokePool), _amount);

        spokePool.depositV3(
            address(this), // address depositor,
            IAcrossSMAFactory(factory).targetChainMulticallHandler(
                _destinationChainId
            ), // address recipient,
            _inputToken, // address inputToken,
            _outputToken, // address outputToken,
            _amount, // uint256 inputAmount,
            _minAmount, // uint256 outputAmount,
            _destinationChainId, // uint256 destinationChainId,
            address(0), // address exclusiveRelayer,
            uint32(block.timestamp), // uint32 quoteTimestamp,
            uint32(block.timestamp + 1 hours), // uint32 fillDeadline,
            0, // uint32 exclusivityDeadline,
            _message // bytes calldata message
        );
    }

    function smaToCustody(address _token, uint256 _amount) external onlyPSymm {
        IERC20(_token).approve(address(pSymm), _amount);
        pSymm.addressToCustody(custodyId, _token, _amount);
    }
}
