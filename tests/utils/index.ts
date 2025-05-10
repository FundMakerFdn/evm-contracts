import { PPMHelper } from "./ppmHelper";
import { ethers } from "hardhat";
import { SubjectType } from "../fixtures/DeployFixture";

export function getMultiPartyCustodyId(subject: SubjectType): any {

}

export async function getSinglePartyCustodyId(subject: SubjectType): Promise<{
  custodyId: string;
  ppmHelper: PPMHelper;
  pubKeyParity: number;
  pubKeyX: string;
}> {

  // Get chain ID and contract address
  const chainId = await ethers.provider.getNetwork().then((n) => n.chainId);
  const contractAddress = await subject.psymm.getAddress();

  // Create public key values - use user1's address as the public key for verification
  const pubKeyParity = 0;
  const pubKeyX = ethers.zeroPadValue(subject.user1.address, 32);
  const ppmHelper = new PPMHelper(Number(chainId), contractAddress as `0x${string}`);

  ppmHelper.custodyToAddress(
    subject.user1.address, // recipient
    0, // state
    [{
      parity: pubKeyParity,
      x: pubKeyX,
    }] // both parties required
  );

  ppmHelper.changeCustodyState(1, 0, [{
    parity: pubKeyParity,
    x: pubKeyX,
  }]);

  const custodyId = ppmHelper.getCustodyID();

  return {
    custodyId,
    ppmHelper,
    pubKeyParity,
    pubKeyX,
  }
}
 


export function createLeaf(action: string, chainId: bigint, contractAddress: string, custodyState: number, encodedParams: string, pubKeyParity: number, pubKeyX: string): string {
  // Mimic the keccak256 hashing from verifyLeaf
  return ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32"],
      [
        ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["string", "uint256", "address", "uint8", "bytes", "uint8", "bytes32"],
            [action, chainId, contractAddress, custodyState, encodedParams, pubKeyParity, pubKeyX]
          )
        ),
      ]
    )
  );
}