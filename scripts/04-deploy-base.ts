import { ethers } from "hardhat";
import { generateMessageForMulticallHandler } from "../test-old/shared/utils";
import hre from "hardhat";
async function main() {

    const [owner] = await ethers.getSigners();
    console.log('Deploying with owner', owner.address);

    const psymm = await hre.ethers.deployContract("PSYMM", []);
    await psymm.waitForDeployment();

    console.log('PSYMM deployed to', await psymm.getAddress());

}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 