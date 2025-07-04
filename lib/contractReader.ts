import { createPublicClient, http } from 'viem'
import TurboTokenABI from './abi/TurboToken.json'
import { megaethTestnet } from '@/lib/chains'

export async function getTokenOnChainData(contractAddress: `0x${string}`) {
  const client = createPublicClient({
    chain: megaethTestnet,
    transport: http(),
  })

  // Explicit return type to fix "unknown" error
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


