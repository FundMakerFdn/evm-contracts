// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IAny2EVMMessageReceiver.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./CCIPSMA.sol";


contract CCIPReceiver is IAny2EVMMessageReceiver, Ownable {
    IRouterClient public immutable router;
    
    mapping(uint64 => mapping(address => bool)) public whitelistedSourceSenders;
    mapping(address => bool) public whitelistedLocalDestinations;
    
    event MessageReceivedAndForwarded(
        bytes32 indexed messageId,
        uint64 indexed sourceChainSelector,
        address indexed sourceSender,
        address targetSMA,
        bytes data
    );
    event SourceSenderWhitelisted(uint64 indexed chainSelector, address indexed senderAddress, bool status);
    event LocalDestinationWhitelisted(address indexed destinationSMA, bool status);
    
    constructor(address _routerAddress) Ownable(msg.sender) {
        require(_routerAddress != address(0), "CCIPReceiver: Invalid router address");
        router = IRouterClient(_routerAddress);
    }
    

    function setSourceSenderWhitelist(uint64 _sourceChainSelector, address _sourceCCIPContractAddress, bool _status) external onlyOwner {
        require(_sourceCCIPContractAddress != address(0), "CCIPReceiver: Invalid source CCIP contract address");
        whitelistedSourceSenders[_sourceChainSelector][_sourceCCIPContractAddress] = _status;
        emit SourceSenderWhitelisted(_sourceChainSelector, _sourceCCIPContractAddress, _status);
    }

    function setLocalDestinationWhitelist(address _localCCIPSMAAddress, bool _status) external onlyOwner {
        require(_localCCIPSMAAddress != address(0), "CCIPReceiver: Invalid local CCIPSMA address");
        whitelistedLocalDestinations[_localCCIPSMAAddress] = _status;
        emit LocalDestinationWhitelisted(_localCCIPSMAAddress, _status);
    }
    
    function ccipReceive(Client.Any2EVMMessage memory message) external override {
        require(msg.sender == address(router), "CCIPReceiver: Caller is not the CCIP Router");
        
        address sourceCCIPContract = abi.decode(message.sender, (address));
                require(
            whitelistedSourceSenders[message.sourceChainSelector][sourceCCIPContract],
            "CCIPReceiver: Source CCIP contract not whitelisted for this chain selector"
        );
        
        CCIPSMA.CCIPMessage memory decodedCCIPMessage = abi.decode(message.data, (CCIPSMA.CCIPMessage));
        
        address targetLocalSMA = decodedCCIPMessage.targetSMA;
        
        require(whitelistedLocalDestinations[targetLocalSMA], "CCIPReceiver: Target local SMA not whitelisted");
        
        (bool success, ) = targetLocalSMA.call(
            abi.encodeWithSelector(CCIPSMA.handleCCIPMessage.selector, message.data)
        );
        require(success, "CCIPReceiver: Failed to forward message to target SMA");

        emit MessageReceivedAndForwarded(
            message.messageId,
            message.sourceChainSelector,
            sourceCCIPContract,
            targetLocalSMA,
            message.data
        );
    }
    
    receive() external payable {}
} 