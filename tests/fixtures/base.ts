import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";

export interface TestContext {
  deployer: Signer;
  users: Signer[];
}

export async function deployBaseFixture(): Promise<TestContext> {
  const [deployer, ...users] = await ethers.getSigners();

  return {
    deployer,
    users,
  };
}

export async function loadBaseFixture() {
  return loadFixture(deployBaseFixture);
}

// Common test utilities
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const MAX_UINT256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

// Helper function to increase time
export async function increaseTime(seconds: number) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

// Helper function to get latest block timestamp
export async function getLatestBlockTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  if (!block) throw new Error("Failed to get latest block");
  return block.timestamp;
} 