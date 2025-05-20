// Index.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../PSYMM/PSYMM.sol";
import "./AcrossSMA.sol";
import "../../interfaces/V3SpokePoolInterface.sol";

contract AcrossSMAFactory is IAcrossSMAFactory {
    event AcrossSMADeployed(address indexed acrossSMAAddress);
    address public immutable pSymmAddress;
    V3SpokePoolInterface public spokePool;

    mapping(address => bool) public inputTokenAllowed;
    mapping(address => bool) public outputTokenAllowed;
    mapping(uint256 => address) public targetChainMulticallHandler;

    constructor(address _pSymmAddress) {
        pSymmAddress = _pSymmAddress;
    }

    modifier onlyPSymm() {
        require(msg.sender == pSymmAddress, "Only pSymm can call");
        _;
    }

    function deploySMA(
        bytes32 custodyId,
        bytes calldata data,
        address _whitelistedCaller // TODO: Remove this after testing
    ) external override returns (address) {
        require(
            msg.sender == address(pSymmAddress),
            "AcrossSMAFactory: Only pSymm can deploy SMAs"
        );
        // Extract the bytes32 custodyId from the bytes data
        require(data.length >= 32, "Data too short for custodyId");
        // bytes32 custodyId;

        // assembly {
        //     custodyId := calldataload(data.offset)
        // }

        AcrossSMA acrossSMA = new AcrossSMA(
            pSymmAddress,
            address(spokePool),
            address(this),
            custodyId,
            _whitelistedCaller
        );

        emit AcrossSMADeployed(address(acrossSMA));
        return address(acrossSMA);
    }

    function setInputTokenAllowed(address _token, bool _allowed) external {
        inputTokenAllowed[_token] = _allowed;
    }

    function setOutputTokenAllowed(address _token, bool _allowed) external {
        outputTokenAllowed[_token] = _allowed;
    }

    function setTargetChainMulticallHandler(
        uint256 _chainId,
        address _multicallHandler
    ) external {
        targetChainMulticallHandler[_chainId] = _multicallHandler;
    }
}
