import { ethers } from "hardhat";
import { PSYMM, MockERC20, IndexRegistry, IndexFactory } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

export interface SubjectType {
  owner: SignerWithAddress;
  user1: SignerWithAddress;
  user2: SignerWithAddress;
  user3: SignerWithAddress;
  psymm: PSYMM;
  usdc: MockERC20;
  usde: MockERC20;
  indexRegistry: IndexRegistry;
  indexFactory: IndexFactory;
}

export const deployFixture = async (): Promise<SubjectType> => {
  const signers = await ethers.getSigners();
  const subject: SubjectType = {
    owner: signers[0],
    user1: signers[1],
    user2: signers[2],
    user3: signers[3],
  } as SubjectType;

  // Deploy contracts
  const psymm = await (await ethers.getContractFactory("PSYMM")).deploy() as unknown as PSYMM;
  const usdc = await (await ethers.getContractFactory("MockERC20")).deploy("USDC", "USDC", 6) as unknown as MockERC20;
  const usde = await (await ethers.getContractFactory("MockERC20")).deploy("USDE", "USDE", 6) as unknown as MockERC20;

  await psymm.waitForDeployment();
  await usdc.waitForDeployment();
  await usde.waitForDeployment();

  subject.psymm = psymm;
  subject.usdc = usdc;
  subject.usde = usde;

  // Deploy IndexRegistry first
  const IndexRegistry = await ethers.getContractFactory("IndexRegistry");
  subject.indexRegistry = await IndexRegistry.deploy();
  await subject.indexRegistry.waitForDeployment();

  // Deploy IndexFactory with PSYMM address
  const IndexFactory = await ethers.getContractFactory("IndexFactory");
  subject.indexFactory = await IndexFactory.deploy(
    await subject.psymm.getAddress()
  );
  await subject.indexFactory.waitForDeployment();

  return subject;

}; 