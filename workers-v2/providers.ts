// Shared provider utilities for both frontend and backend
// Centralizes RPC configuration to avoid duplication

import { ethers } from 'ethers'
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from './chains'

// RPCs per chain (prefer env override, fall back to lib/chains)
export const rpcByChain: Record<number, string> = {
  6342: process.env.MEGAETH_RPC_URL ?? megaethTestnet.rpcUrls.default.http[0],
  9999: process.env.MEGAETH_MAINNET_RPC ?? megaethMainnet.rpcUrls.default.http[0],
  11155111: process.env.SEPOLIA_RPC_URL ?? sepoliaTestnet.rpcUrls.default.http[0],
}

// Backend provider for workers
export function providerFor(chainId: number) {
  const url = rpcByChain[chainId]
  if (!url) throw new Error(`No RPC for chain ${chainId}`)
  return new ethers.JsonRpcProvider(url, { chainId, name: `chain-${chainId}` })
}

// Frontend RPC URLs for Wagmi
export function getRpcUrl(chainId: number): string {
  const url = rpcByChain[chainId]
  if (!url) throw new Error(`No RPC for chain ${chainId}`)
  return url
}
