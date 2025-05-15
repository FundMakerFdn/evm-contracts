// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockCCIPRouter
 * @dev Mock implementation of Chainlink's CCIP Router for testing
 */
contract MockCCIPRouter is Ownable, IRouterClient {
    bytes32 public mockMessageId;
    uint256 public mockFee;
    address public mockReceiver;
    
    event MessageSent(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        address receiver,
        bytes data,
        address feeToken,
        uint256 fees
    );

    constructor() Ownable(msg.sender) {
        mockMessageId = keccak256(abi.encode("mock-message-id"));
        mockFee = 0.01 ether;
    }
    
    function setMessageId(bytes32 _messageId) external onlyOwner {
        mockMessageId = _messageId;
    }
    
    function setFee(uint256 _fee) external onlyOwner {
        mockFee = _fee;
    }
    
    function setReceiver(address _receiver) external onlyOwner {
        mockReceiver = _receiver;
    }


    function ccipSend(
        uint64 destinationChainSelector, 
        Client.EVM2AnyMessage calldata message
    ) external payable override returns (bytes32) {
        address receiver = abi.decode(message.receiver, (address));
        
        emit MessageSent(
            mockMessageId,
            destinationChainSelector,
            receiver,
            message.data,
            message.feeToken,
            msg.value > 0 ? msg.value : mockFee
        );
        
        return mockMessageId;
    }
    

    function getFee(
        uint64 /*destinationChainSelector*/,
        Client.EVM2AnyMessage calldata /*message*/
    ) external view override returns (uint256) {
        return mockFee;
    }
    

    function isChainSupported(uint64 /*chainSelector*/) external pure override returns (bool) {
        return true;
    }

    receive() external payable {}
} 