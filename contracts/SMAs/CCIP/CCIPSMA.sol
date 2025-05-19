// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@chainlink/contracts-ccip/src/v0.8/ccip/interfaces/IRouterClient.sol";
import "../../PSYMM/PSYMM.sol";
import "./CCIP.sol";
import "./ICCIPSMAFactory.sol";
import "../../PSYMM/Schnorr.sol";

contract CCIPSMA {
    using SafeERC20 for IERC20;

    PSYMM public immutable pSymm;
    CCIP public immutable ccipContract;
    address public immutable localCCIPReceiver;
    ICCIPSMAFactory public immutable factory;
    bytes32 public immutable custodyId;

    // Add mapping for authorized bots
    mapping(address => bool) public whitelistedCallers;

    enum MessageType {
        UPDATE_PPM,
        CUSTOM_ACTION
    }

    struct VerificationData {
        bytes32 id;
        uint8 state;
        uint256 timestamp;
        Schnorr.PPMKey pubKey;
        Schnorr.Signature sig;
        bytes32[] merkleProof;
    }

    struct CCIPMessage {
        MessageType messageType;
        address targetSMA;
        bytes data;
    }

    event MessageSent(
        uint64 destinationChainSelector,
        address targetSMA,
        MessageType messageType,
        bytes data
    );
    event UpdatePPMMessageReceived(
        bytes32 indexed custodyId,
        bytes32 newPPM,
        uint256 timestamp
    );
    event CustomActionMessageReceived(address indexed targetSMA, bytes data);
    event WhitelistedCallerChanged(address indexed caller, bool whitelisted);

    modifier onlyPSymm() {
        require(msg.sender == address(pSymm), "CCIPSMA: Only pSymm can call");
        _;
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

    modifier onlyLocalCCIPReceiver() {
        require(
            msg.sender == localCCIPReceiver,
            "CCIPSMA: Caller is not the local CCIPReceiver"
        );
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

    modifier allowedDestinationChain(uint64 _chainSelector) {
        require(
            factory.destinationChainAllowed(_chainSelector),
            "CCIPSMA: Destination chain not allowed"
        );
        _;
    }

    constructor(
        address _pSymmAddress,
        address _ccipContractAddress,
        address _localCCIPReceiverAddress,
        address _factoryAddress,
        bytes32 _custodyId,
        address _whitelistedCaller // TODO: Remove this after testing
    ) {
        require(_pSymmAddress != address(0), "CCIPSMA: Invalid pSymm address");
        require(
            _ccipContractAddress != address(0),
            "CCIPSMA: Invalid CCIP contract address"
        );
        require(
            _localCCIPReceiverAddress != address(0),
            "CCIPSMA: Invalid local CCIPReceiver address"
        );
        require(
            _factoryAddress != address(0),
            "CCIPSMA: Invalid factory address"
        );

        pSymm = PSYMM(_pSymmAddress);
        ccipContract = CCIP(payable(_ccipContractAddress));
        localCCIPReceiver = _localCCIPReceiverAddress;
        factory = ICCIPSMAFactory(_factoryAddress);
        custodyId = _custodyId;

        // TODO: Remove this after testing
        whitelistedCallers[_whitelistedCaller] = true;
    }

    function setWhitelistedCaller(
        address caller,
        bool whitelisted
    ) external onlyPSymmOrWhitelistedCaller {
        require(caller != address(0), "CCIPSMA: Invalid caller address");
        whitelistedCallers[caller] = whitelisted;
        emit WhitelistedCallerChanged(caller, whitelisted);
    }

    function sendUpdatePPM(
        uint64 _destinationChainSelector,
        address _destinationTargetSMA,
        bytes32 _newPPM,
        VerificationData calldata _verificationData,
        address _feeToken
    )
        external
        onlyWhitelistedCaller
        allowedDestinationChain(_destinationChainSelector)
        returns (bytes32 messageId)
    {
        require(
            _destinationTargetSMA != address(0),
            "CCIPSMA: Invalid destination target SMA"
        );
        require(
            _verificationData.id == custodyId,
            "CCIPSMA: Invalid custody ID"
        );

        CCIPMessage memory message = CCIPMessage({
            messageType: MessageType.UPDATE_PPM,
            targetSMA: _destinationTargetSMA,
            data: abi.encode(_newPPM, _verificationData)
        });

        bytes memory encodedCCIPMessage = abi.encode(message);

        messageId = ccipContract.sendMessage(
            _destinationChainSelector,
            encodedCCIPMessage,
            _feeToken
        );

        emit MessageSent(
            _destinationChainSelector,
            _destinationTargetSMA,
            MessageType.UPDATE_PPM,
            message.data
        );
    }

    function sendCustomMessage(
        uint64 _destinationChainSelector,
        address _destinationTargetSMA,
        bytes calldata _customData,
        address _feeToken
    ) external onlyPSymm allowedDestinationChain(_destinationChainSelector) {
        require(
            _destinationTargetSMA != address(0),
            "CCIPSMA: Invalid destination target SMA"
        );

        CCIPMessage memory message = CCIPMessage({
            messageType: MessageType.CUSTOM_ACTION,
            targetSMA: _destinationTargetSMA,
            data: _customData
        });

        bytes memory encodedCCIPMessage = abi.encode(message);

        ccipContract.sendMessage(
            _destinationChainSelector,
            encodedCCIPMessage,
            _feeToken
        );

        emit MessageSent(
            _destinationChainSelector,
            _destinationTargetSMA,
            MessageType.CUSTOM_ACTION,
            _customData
        );
    }

    function handleCCIPMessage(
        bytes calldata _encodedMessage
    ) external onlyLocalCCIPReceiver {
        CCIPMessage memory decodedMessage = abi.decode(
            _encodedMessage,
            (CCIPMessage)
        );

        require(
            decodedMessage.targetSMA == address(this),
            "CCIPSMA: Message not intended for this SMA"
        );

        if (decodedMessage.messageType == MessageType.UPDATE_PPM) {
            (bytes32 newPPM, VerificationData memory verificationData) = abi
                .decode(decodedMessage.data, (bytes32, VerificationData));
            _executeUpdatePPM(newPPM, verificationData);
            emit UpdatePPMMessageReceived(
                custodyId,
                newPPM,
                verificationData.timestamp
            );
        } else if (decodedMessage.messageType == MessageType.CUSTOM_ACTION) {
            emit CustomActionMessageReceived(
                decodedMessage.targetSMA,
                decodedMessage.data
            );
        }
    }

    function _executeUpdatePPM(
        bytes32 _newPPM,
        VerificationData memory _verificationData
    ) internal {
        require(
            _verificationData.id == custodyId,
            "CCIPSMA: Verification data custody ID mismatch"
        );

        PSYMM.VerificationData memory psymmVerificationData = PSYMM
            .VerificationData({
                id: _verificationData.id,
                state: _verificationData.state,
                timestamp: _verificationData.timestamp,
                pubKey: _verificationData.pubKey,
                sig: _verificationData.sig,
                merkleProof: _verificationData.merkleProof
            });

        pSymm.updatePPM(_newPPM, psymmVerificationData);
    }

    function smaToCustody(
        address _token,
        uint256 _amount
    ) public onlySelfOrPSYMM {
        IERC20(_token).approve(address(pSymm), _amount);
        pSymm.addressToCustody(custodyId, _token, _amount);
    }

    function approveToken(
        address _token,
        address _spender,
        uint256 _amount
    ) public onlyWhitelistedCaller {
        IERC20(_token).approve(_spender, _amount);
    }
}
