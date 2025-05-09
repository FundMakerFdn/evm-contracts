import { ethers } from "hardhat";

async function main() {

    const [owner] = await ethers.getSigners();

    console.log('Using', owner.address);

    const spokePoolAddress = "0xe35e9842fceaca96570b734083f4a58e8f7c5f2a"; // Replace with actual spoke pool address
    const spokePool = await ethers.getContractAt("V3SpokePoolInterface", spokePoolAddress);


    // Prepare deposit parameters
    const depositor = owner.address;
    const recipient = owner.address;
    const inputToken = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
    const outputToken = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const inputAmount = ethers.parseUnits("1", 6);
    const outputAmount = ethers.parseUnits("0.97", 6);
    const destinationChainId = 8453; // Base Chain
    const exclusiveRelayer = ethers.ZeroAddress;
    const quoteTimestamp = Math.floor(Date.now() / 1000);
    const fillDeadline = quoteTimestamp + 3600; // 1 hour from now
    const exclusivityDeadline = 0;
    const message = "0x"; // Empty message

    // // Approve tokens if needed
    const usdcToken = await ethers.getContractAt("MockERC20", inputToken);

    await usdcToken.connect(owner).approve(spokePoolAddress, inputAmount);

    // // Make the deposit

    await spokePool.connect(owner).depositV3(
        depositor,
        recipient,
        inputToken,
        outputToken,
        inputAmount,
        outputAmount,
        destinationChainId,
        exclusiveRelayer,
        quoteTimestamp,
        fillDeadline,
        exclusivityDeadline,
        message,
        { value: 0 } // Include value if depositing native token
    )


}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 