// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract CCIP is Ownable {
    using SafeERC20 for IERC20;

    IRouterClient public immutable router;
    mapping(uint64 => address) public destinationCCIPReceivers;
    mapping(address => bool) public whitelistedCallers;

    event CCIPMessageSent(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        address receiver,
        bytes data,
        address feeToken,
        uint256 fees
    );

    event DestinationCCIPReceiverUpdated(
        uint64 indexed chainSelector,
        address indexed receiverAddress
    );
    event CallerWhitelisted(address indexed caller, bool status);

    constructor(address _router) Ownable(msg.sender) {
        require(_router != address(0), "CCIP: Invalid router address");
        router = IRouterClient(_router);
    }

    modifier onlyWhitelisted() {
        require(whitelistedCallers[msg.sender], "CCIP: Caller not whitelisted");
        _;
    }

    function setDestinationCCIPReceiver(
        uint64 _chainSelector,
        address _receiverAddress
    ) external onlyOwner {
        require(
            _receiverAddress != address(0),
            "CCIP: Invalid CCIPReceiver address"
        );
        destinationCCIPReceivers[_chainSelector] = _receiverAddress;
        emit DestinationCCIPReceiverUpdated(_chainSelector, _receiverAddress);
    }

    function setCallerWhitelist(
        address _caller,
        bool _status
    ) external onlyOwner {
        whitelistedCallers[_caller] = _status;
        emit CallerWhitelisted(_caller, _status);
    }

    function sendMessage(
        uint64 _destinationChainSelector,
        bytes calldata _encodedCCIPMessage,
        address _feeToken
    ) external onlyWhitelisted returns (bytes32 messageId) {
        address receiverOnDestinationChain = destinationCCIPReceivers[
            _destinationChainSelector
        ];
        require(
            receiverOnDestinationChain != address(0),
            "CCIP: Destination CCIPReceiver not configured"
        );

        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(receiverOnDestinationChain),
            data: _encodedCCIPMessage,
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: Client._argsToBytes(
                Client.EVMExtraArgsV1({gasLimit: 200_000})
            ),
            feeToken: _feeToken
        });

        uint256 fees = router.getFee(_destinationChainSelector, message);

        if (_feeToken != address(0)) {
            IERC20(_feeToken).safeTransferFrom(msg.sender, address(this), fees);
            IERC20(_feeToken).approve(address(router), fees);
            messageId = router.ccipSend(_destinationChainSelector, message);
        } else {
            messageId = router.ccipSend{value: fees}(
                _destinationChainSelector,
                message
            );
        }

        emit CCIPMessageSent(
            messageId,
            _destinationChainSelector,
            receiverOnDestinationChain,
            _encodedCCIPMessage,
            _feeToken,
            fees
        );

        return messageId;
    }

    receive() external payable {}
}
