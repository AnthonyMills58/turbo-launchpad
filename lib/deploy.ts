// /lib/deploy.ts

import { ethers } from 'ethers'
import TurboToken from './abi/TurboToken.json' // Make sure ABI is exported properly

// Define the deploy function
export async function deployTokenOnChain({
  name,
  symbol,
  supply,
  creatorAddress,
}: {
  name: string
  symbol: string
  supply: number
  creatorAddress: string
}) {
  const provider = new ethers.JsonRpcProvider(process.env.MEGAETH_RPC_URL)
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider)

  const TurboTokenFactory = new ethers.ContractFactory(
    TurboToken.abi,
    TurboToken.bytecode,
    signer
  )

  const contract = await TurboTokenFactory.deploy(
    name,
    symbol,
    ethers.parseEther(supply.toString()),
    creatorAddress
  )

  await contract.waitForDeployment()
  const contractAddress = await contract.getAddress()

  console.log('✅ Contract deployed at:', contractAddress)
  return contractAddress
}
