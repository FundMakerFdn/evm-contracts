// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../../interfaces/ICCIPSMAFactory.sol";
import "./CCIPSMA.sol";
import "../../PSYMM/PSYMM.sol";

contract CCIPSMAFactory is ICCIPSMAFactory, Ownable {
    PSYMM public immutable pSymm;
    address public immutable ccipContractAddress;
    address public localCCIPReceiverAddress;

    mapping(uint64 => bool) public destinationChains;

    event CCIPSMADeployed(
        address indexed smaAddress,
        bytes32 indexed custodyId,
        address localCCIPReceiver
    );
    event DestinationChainUpdated(uint64 indexed chainSelector, bool allowed);
    event LocalCCIPReceiverUpdated(address indexed newReceiverAddress);

    constructor(
        address _pSymmAddress,
        address _ccipContractAddress,
        address _localCCIPReceiverAddress
    ) Ownable(msg.sender) {
        require(_pSymmAddress != address(0), "Factory: Invalid pSymm address");
        require(
            _ccipContractAddress != address(0),
            "Factory: Invalid CCIP contract address"
        );
        require(
            _localCCIPReceiverAddress != address(0),
            "Factory: Invalid local CCIPReceiver address"
        );

        pSymm = PSYMM(_pSymmAddress);
        ccipContractAddress = _ccipContractAddress;
        localCCIPReceiverAddress = _localCCIPReceiverAddress;
    }

    function ccipAddress() external view returns (address) {
        return ccipContractAddress;
    }

    function getLocalCCIPReceiver() external view returns (address) {
        return localCCIPReceiverAddress;
    }

    function setLocalCCIPReceiver(
        address _newLocalCCIPReceiverAddress
    ) external onlyOwner {
        require(
            _newLocalCCIPReceiverAddress != address(0),
            "Factory: Invalid new local CCIPReceiver address"
        );
        localCCIPReceiverAddress = _newLocalCCIPReceiverAddress;
        emit LocalCCIPReceiverUpdated(_newLocalCCIPReceiverAddress);
    }

    function destinationChainAllowed(
        uint64 chainSelector
    ) external view override returns (bool) {
        return destinationChains[chainSelector];
    }

    function setDestinationChain(
        uint64 _chainSelector,
        bool _allowed
    ) external onlyOwner {
        destinationChains[_chainSelector] = _allowed;
        emit DestinationChainUpdated(_chainSelector, _allowed);
    }

    /*
     * @param data: Currently it is only used custodyId
     * @param _whitelistedCaller: Address of the whitelisted caller other than pSymm
     * @warning `data` might be used for other purposes in the future
     * @dev TODO: Remove `_whitelistedCaller` after testing
     */
    function deploySMA(
        bytes32 custodyId,
        bytes calldata data,
        address _whitelistedCaller
    ) external override returns (address) {
        require(
            msg.sender == address(pSymm),
            "CCIPSMAFactory: Only pSymm can deploy SMAs"
        );

        CCIPSMA sma = new CCIPSMA(
            address(pSymm),
            ccipContractAddress,
            localCCIPReceiverAddress,
            address(this),
            custodyId,
            _whitelistedCaller
        );

        emit CCIPSMADeployed(address(sma), custodyId, localCCIPReceiverAddress);

        return address(sma);
    }
}
