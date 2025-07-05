import { createPublicClient, http } from 'viem'
import TurboTokenABI from './abi/TurboToken.json'
import { megaethTestnet } from '@/lib/chains'

export async function getTokenOnChainData(contractAddress: `0x${string}`) {
  const client = createPublicClient({
    chain: megaethTestnet,
    transport: http(),
  })

  const result = await client.readContract({
    address: contractAddress,
    abi: TurboTokenABI.abi,
    functionName: 'tokenInfo',
  }) as [
    string,   // _creator
    string,   // _platformFeeRecipient
    bigint,   // _raiseTarget
    bigint,   // _maxSupply
    bigint,   // _basePrice
    bigint,   // _slope
    bigint,   // _totalRaised
    boolean,  // _graduated
    bigint    // _creatorLockAmount
  ]

  const airdropFinalized = await client.readContract({
    address: contractAddress,
    abi: TurboTokenABI.abi,
    functionName: 'airdropFinalized',
  }) as boolean

  return {
    raiseTarget: Number(result[2]) / 1e18,
    totalRaised: Number(result[6]) / 1e18,
    basePrice: Number(result[4]) / 1e18,
    currentPrice: Number(result[4]) / 1e18 + Number(result[5]) / 1e18 * (Number(result[6]) / 1e18), // ← opcjonalnie
    graduated: result[7],
    creatorLockAmount: Number(result[8]) / 1e18,
    airdropFinalized, // ✅ wymagane pole
  }
}



