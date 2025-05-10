// Index.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";  
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../PSYMM/PSYMM.sol";
import "./AcrossSMA.sol";
import "./V3SpokePoolInterface.sol";
interface IAcrossSMAFactory {    
    function inputTokenAllowed(address _token) external view returns (bool);
    function outputTokenAllowed(address _token) external view returns (bool);
    function targetChainMulticallHandler(uint256 _chainId) external view returns (address);

    function spokePool() external view returns (address);
    function pSymmAddress() external view returns (address);


}
