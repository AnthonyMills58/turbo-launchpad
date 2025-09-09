import { ethers } from 'ethers'
import { DEX_ROUTER_BY_CHAIN, routerAbi, factoryAbi } from './dex'
import { chainsById } from './chains'

/**
 * Client-side function to check if a token is on DEX
 * This is fast and doesn't require database access
 */
export async function checkIfTokenOnDex(
  contractAddress: string,
  chainId: number
): Promise<boolean> {
  try {
    const chain = chainsById[chainId]
    if (!chain) {
      console.warn('[checkIfTokenOnDex] Unsupported chain ID:', chainId)
      return false
    }

    const provider = new ethers.JsonRpcProvider(chain.rpcUrls.default.http[0])
    const routerAddress = DEX_ROUTER_BY_CHAIN[chainId]
    const router = new ethers.Contract(routerAddress, routerAbi, provider)

    const factoryAddress = await router.factory()
    const wethAddress = await router.WETH()
    const factory = new ethers.Contract(factoryAddress, factoryAbi, provider)
    
    const pairAddress = await factory.getPair(contractAddress, wethAddress)

    // Token is on DEX if pair exists and is not zero address
    const isOnDex = pairAddress && pairAddress !== ethers.ZeroAddress
    
    console.log(`[checkIfTokenOnDex] Token ${contractAddress} on DEX:`, isOnDex)
    return isOnDex
  } catch (error) {
    console.error('[checkIfTokenOnDex] Error:', error)
    return false
  }
}
