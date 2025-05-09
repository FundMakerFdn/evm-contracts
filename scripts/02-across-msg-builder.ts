import { ethers } from "hardhat";
import { generateMessageForMulticallHandler } from "../test/shared/utils";

async function main() {

    const [owner] = await ethers.getSigners();
    const custodyId = ethers.keccak256(ethers.toUtf8Bytes("test-custody"));
    const message = await generateMessageForMulticallHandler(
        owner.address,
        owner.address,
        custodyId,
        owner.address,
        100,
    )

    console.log(message);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 