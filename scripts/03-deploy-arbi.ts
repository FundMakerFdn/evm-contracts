import { ethers } from "hardhat";
import { generateMessageForMulticallHandler } from "../test/shared/utils";
import hre from "hardhat";
async function main() {

    const [owner] = await ethers.getSigners();
    console.log('Deploying with owner', owner.address);

    const psymm = await hre.ethers.deployContract("PSYMM", []);
    await psymm.waitForDeployment();

    console.log('PSYMM deployed to', await psymm.getAddress());

    const ARBI_SPOKE_POOL = "0xe35e9842fceaca96570b734083f4a58e8f7c5f2a"

    const mockAcrossSMA = await hre.ethers.deployContract("MockAcrossSMA", [await psymm.getAddress(), ARBI_SPOKE_POOL]);
    await mockAcrossSMA.waitForDeployment();

    console.log('MockAcrossSMA deployed to', await mockAcrossSMA.getAddress());
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 