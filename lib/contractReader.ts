import { createPublicClient, http } from 'viem'
import TurboTokenABI from './abi/TurboToken.json'
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from '@/lib/chains'
import type { Chain } from 'viem/chains'


// Optional: helper
const chainsById: Record<number, Chain> = {
  6342: megaethTestnet,
  9999: megaethMainnet,
  11155111: sepoliaTestnet,
}


export async function getTokenOnChainData(
  contractAddress: `0x${string}`,
  chainId: number
) {
  const chain = chainsById[chainId]
  if (!chain) throw new Error(`Unsupported chain ID: ${chainId}`)

  const client = createPublicClient({
    chain,
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

  const _totalRaised = result[6]
  const _graduated = result[7]

  return {
    graduated: _graduated,
    totalRaised: Number(_totalRaised) / 1e18,
  }
}



