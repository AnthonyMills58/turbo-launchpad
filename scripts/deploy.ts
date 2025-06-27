import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const TurboToken = await ethers.getContractFactory("TurboToken");
  const contract = await TurboToken.deploy(
    "MyToken",
    "MTK",
    ethers.parseEther("12"),
    deployer.address
  );

  await contract.waitForDeployment();
  console.log("✅ Deployed at:", await contract.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});








