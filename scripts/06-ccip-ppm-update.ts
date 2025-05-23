import { ethers } from 'hardhat';
import { hexlify, randomBytes } from 'ethers';
import { PPMHelper, SMAType } from '../tests/utils/PPMHelper';
import { time } from '@nomicfoundation/hardhat-network-helpers';
import { ERC20 } from '../typechain-types';

async function main() {
  // Constants
  const CHAIN_SELECTOR_SOURCE = 1n;
  const CHAIN_SELECTOR_DEST = 2n;

  // Constants
  const ARBI_PSYMM = '0x06f15f5F613E414117A104CD1395af8C4F6347e6';
  const BASE_PSYMM = '0x4872936e50D695c86779c32Ad91b91aFbbeFC672';
  const ARBI_SMA = '0x213d0351489aFf4EBeE830eCcf27a4A7954Cce91';
  const BASE_SMA = '0x213d0351489aFf4EBeE830eCcf27a4A7954Cce91';
  const ARBI_MULTICALL_HANDLER = '0x924a9f036260DdD5808007E1AA95f08eD08aA569';
  const BASE_MULTICALL_HANDLER = '0x924a9f036260DdD5808007E1AA95f08eD08aA569';
  const USDC_ARBI_ADDRESS = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
  const USDC_BASE_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const CCIP_ROUTER_ADDRESS = '0x881e3A65B4d4a04dD529061dd0071cf975F58bCD';
  const ARBI_CHAIN_ID = 42161;
  const BASE_CHAIN_ID = 8453;

  // Get signers
  const [owner] = await ethers.getSigners();
  console.log('Deploying with owner:', owner.address);

  // Deploy LINK token for fees
  const LinkToken = await ethers.getContractFactory('MockERC20');
  const linkToken = (await LinkToken.deploy(
    'Chainlink Token',
    'LINK',
    18
  )) as unknown as ERC20;
  await linkToken.waitForDeployment();
  await linkToken.mint(
    owner.address,
    ethers.parseEther('1000000000000000000000000')
  );
  console.log('LINK Token deployed at:', await linkToken.getAddress());

  // Deploy PSYMM
  const PSYMMFactory = await ethers.getContractFactory('PSYMM');
  const psymm = await PSYMMFactory.deploy();
  await psymm.waitForDeployment();
  console.log('PSYMM deployed at:', await psymm.getAddress());

  // Deploy CCIP contracts for source chain
  const CCIPFactory = await ethers.getContractFactory('CCIP');
  const ccipSource = await CCIPFactory.deploy(CCIP_ROUTER_ADDRESS);
  await ccipSource.waitForDeployment();
  console.log('CCIP Source deployed at:', await ccipSource.getAddress());

  const CCIPReceiverFactory = await ethers.getContractFactory('CCIPReceiver');
  const ccipReceiverSource = await CCIPReceiverFactory.deploy(
    CCIP_ROUTER_ADDRESS
  );
  await ccipReceiverSource.waitForDeployment();
  console.log(
    'CCIP Receiver Source deployed at:',
    await ccipReceiverSource.getAddress()
  );

  // Deploy CCIP contracts for destination chain
  const ccipDest = await CCIPFactory.deploy(CCIP_ROUTER_ADDRESS);
  await ccipDest.waitForDeployment();
  console.log('CCIP Destination deployed at:', await ccipDest.getAddress());

  const ccipReceiverDest = await CCIPReceiverFactory.deploy(
    CCIP_ROUTER_ADDRESS
  );
  await ccipReceiverDest.waitForDeployment();
  console.log(
    'CCIP Receiver Destination deployed at:',
    await ccipReceiverDest.getAddress()
  );

  // Set destination CCIP receiver
  await ccipSource.setDestinationCCIPReceiver(
    CHAIN_SELECTOR_DEST,
    await ccipReceiverSource.getAddress()
  );
  await ccipReceiverDest.setSourceSenderWhitelist(
    CHAIN_SELECTOR_SOURCE,
    await ccipSource.getAddress(),
    true
  );

  // Deploy CCIPSMAFactory
  const FactoryFactory = await ethers.getContractFactory('CCIPSMAFactory');
  const factorySource = await FactoryFactory.deploy(
    await psymm.getAddress(),
    await ccipSource.getAddress(),
    await ccipReceiverSource.getAddress()
  );
  await factorySource.waitForDeployment();
  await factorySource.setDestinationChain(CHAIN_SELECTOR_DEST, true);
  console.log('CCIPSMA Factory deployed at:', await factorySource.getAddress());

  // Setup PPMHelper
  const chainId = await ethers.provider
    .getNetwork()
    .then((n) => Number(n.chainId));
  const publicKey = {
    parity: 0,
    x: hexlify(randomBytes(32)) as `0x${string}`,
  };

  const psymmAddress = (await psymm.getAddress()) as `0x${string}`;
  const ppmHelper = new PPMHelper(chainId, psymmAddress);

  // Add deploy action to PPMHelper
  const deployDataForSMA = '0x' as `0x${string}`;
  const deployActionIndex = ppmHelper.deploySMA(
    SMAType.CCIP,
    (await factorySource.getAddress()) as `0x${string}`,
    deployDataForSMA,
    0,
    publicKey
  );

  // Add PPM update action
  const updateActionIndex = ppmHelper.updatePPM(0, publicKey);

  // Get custody ID
  const custodyId = ppmHelper.getCustodyID();
  console.log('Custody ID:', custodyId);

  // Setup custody with LINK tokens
  const depositAmount = ethers.parseEther('1');
  await linkToken.mint(owner.address, depositAmount);
  await linkToken.approve(psymmAddress, depositAmount);
  await psymm.addressToCustody(
    custodyId,
    await linkToken.getAddress(),
    depositAmount
  );
  console.log('Custody setup with LINK tokens');

  // Deploy CCIPSMA through PSYMM
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const deployTimestamp = currentTimestamp + 3600;
  const nullifier = hexlify(randomBytes(32)) as `0x${string}`;

  const verificationData = {
    id: custodyId,
    state: 0,
    timestamp: deployTimestamp,
    pubKey: publicKey,
    sig: {
      e: nullifier,
      s: hexlify(randomBytes(32)) as `0x${string}`,
    },
    merkleProof: ppmHelper.getMerkleProof(deployActionIndex),
  };
  await time.setNextBlockTimestamp(deployTimestamp);

  console.log('Deploying CCIPSMA through PSYMM...');
  const deployTx = await psymm.deploySMA(
    SMAType.CCIP,
    await factorySource.getAddress(),
    deployDataForSMA,
    verificationData
  );
  const deployReceipt = await deployTx.wait();

  const deployEvent = deployReceipt?.logs.find((log) => {
    const eventLog = log as any;
    return eventLog.eventName === 'SMADeployed';
  });

  const smaAddress = deployEvent?.args[2];
  console.log('CCIPSMA deployed at:', smaAddress);
  const ccipSMASource = await ethers.getContractAt('CCIPSMA', smaAddress);

  // Deploy destination CCIPSMA
  console.log('Deploying destination CCIPSMA...');
  const CCIPSMAFactory = await ethers.getContractFactory('CCIPSMA');
  const ccipSMADest = await CCIPSMAFactory.deploy(
    await psymm.getAddress(),
    await ccipDest.getAddress(),
    await ccipReceiverDest.getAddress(),
    await factorySource.getAddress(),
    custodyId,
    owner.address
  );
  await ccipSMADest.waitForDeployment();
  console.log(
    'Destination CCIPSMA deployed at:',
    await ccipSMADest.getAddress()
  );

  // Setup whitelisting
  console.log('Setting up whitelisting...');
  await ccipSMASource.setWhitelistedCaller(owner.address, true);
  await ccipSMADest.setWhitelistedCaller(owner.address, true);
  await ccipSource.setCallerWhitelist(owner.address, true);
  await ccipDest.setCallerWhitelist(owner.address, true);
  await ccipSource.setCallerWhitelist(smaAddress, true);
  await ccipSource.setCallerWhitelist(
    await ccipReceiverSource.getAddress(),
    true
  );
  await ccipDest.setCallerWhitelist(await ccipReceiverDest.getAddress(), true);
  await ccipReceiverDest.setSourceSenderWhitelist(
    CHAIN_SELECTOR_SOURCE,
    await ccipSource.getAddress(),
    true
  );
  await ccipReceiverDest.setLocalDestinationWhitelist(
    await ccipSMADest.getAddress(),
    true
  );

  // Setup verification data for PPM update
  const updateTimestamp = deployTimestamp + 3600;
  const updateVerificationData = {
    id: custodyId,
    state: 0,
    timestamp: updateTimestamp,
    pubKey: publicKey,
    sig: {
      e: hexlify(randomBytes(32)) as `0x${string}`,
      s: hexlify(randomBytes(32)) as `0x${string}`,
    },
    merkleProof: ppmHelper.getMerkleProof(updateActionIndex),
  };

  await time.setNextBlockTimestamp(updateTimestamp);

  // Update PPM on source chain
  console.log('Updating PPM on source chain...');
  const updateTx = await psymm.updatePPM(custodyId, updateVerificationData);
  const updateReceipt = await updateTx.wait();
  console.log('PPM updated on source chain');

  // Transfer LINK tokens to CCIPSMA for fees
  console.log('Transferring LINK tokens for fees...');
  console.log('Owner balance:', await linkToken.balanceOf(owner.address));
  await linkToken
    .connect(owner)
    .transfer(await ccipSMASource.getAddress(), ethers.parseEther('100'));

  // Approve CCIP to spend LINK tokens
  console.log('Approving CCIP to spend LINK tokens...');
  await ccipSMASource.approveToken(
    await linkToken.getAddress(),
    await ccipSource.getAddress(),
    ethers.parseEther('1000000000000000000000000')
  );

  // Send updatePPM through CCIPSMA to CCIP
  console.log('Sending PPM update through CCIPSMA to CCIP...');
  const sendUpdatePPMTx = await ccipSMASource.sendUpdatePPM(
    CHAIN_SELECTOR_DEST,
    await ccipSMADest.getAddress(),
    custodyId,
    updateVerificationData,
    await linkToken.getAddress()
  );
  const sendReceipt = await sendUpdatePPMTx.wait();
  console.log('PPM update sent through CCIPSMA');

  console.log('\nPPM Update Flow Completed Successfully');
  console.log('Transaction Hashes:');
  console.log('Deploy CCIPSMA:', deployTx.hash);
  console.log('Update PPM:', updateTx.hash);
  console.log('Send Update PPM:', sendUpdatePPMTx.hash);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
