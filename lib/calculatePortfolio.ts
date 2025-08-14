import { ethers } from 'ethers'
import db from './db'
import TurboTokenABI from './abi/TurboToken.json'
import { PortfolioData, CreatedTokenInfo, HeldTokenInfo } from '../types/portfolio'
import { megaethMainnet, megaethTestnet, sepoliaTestnet } from './chains'

// -------- RPCs per chain (add more/fallbacks here if you have them) --------
const rpcUrlsByChainId: Record<number, string> = {
  6342: megaethTestnet.rpcUrls.default.http[0],
  9999: megaethMainnet.rpcUrls.default.http[0],
  11155111: sepoliaTestnet.rpcUrls.default.http[0],
}

// -------- provider cache (module-level, reused) --------
const providerCache: Map<number, ethers.JsonRpcProvider> = new Map()

function getProvider(chainId: number): ethers.JsonRpcProvider {
  const cached = providerCache.get(chainId)
  if (cached) return cached

  const url = rpcUrlsByChainId[chainId]
  if (!url) throw new Error(`Unsupported chainId ${chainId}`)

  // Provide a "static" network hint to reduce handshake churn
  const network = { chainId, name: `chain-${chainId}` }
  const provider = new ethers.JsonRpcProvider(url, network)

  providerCache.set(chainId, provider)
  return provider
}

// -------- generic retry with exponential backoff --------
function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)) }

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 350): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await sleep(delayMs * Math.pow(2, i)) // backoff
    }
  }
  throw lastErr
}

export async function calculatePortfolio(wallet: string): Promise<PortfolioData> {
  const rows = await db.query(`SELECT * FROM tokens`)
  const createdTokens: CreatedTokenInfo[] = []
  const heldTokens: HeldTokenInfo[] = []

  let totalValueEth = 0
  const walletLc = wallet.toLowerCase()

  // NOTE: for rate-limit friendliness we keep this loop sequential.
  for (const token of rows.rows) {
    const {
      creator_wallet,
      contract_address,
      chain_id,
      total_supply,
      creator_lock_amount,
      symbol,
    } = token

    if (!chain_id || !rpcUrlsByChainId[chain_id]) continue

    const provider = getProvider(chain_id)
    const contract = new ethers.Contract(contract_address, TurboTokenABI.abi, provider)

    // wallet’s ERC20 balance (wei) with retry
    const balanceWei: bigint = await withRetry(() => contract.balanceOf(wallet))

    // If this wallet is the creator, include “created” row
    if (creator_wallet && String(creator_wallet).toLowerCase() === walletLc) {
      const othersHold = Number(total_supply ?? 0) - Number(creator_lock_amount ?? 0)
      const contractEthBalWei = await withRetry(() => provider.getBalance(contract_address))

      createdTokens.push({
        chainId: chain_id,
        symbol,
        othersHoldRaw: String(Math.max(othersHold, 0)),
        contractEthBalance: ethers.formatEther(contractEthBalWei),
      })
    }

    // If this wallet holds tokens, estimate curve refund using on-chain math
    if (balanceWei > 0n) {
      const refundWei: bigint = await withRetry(() => contract.getSellPrice(balanceWei))
      const tokensValueEth = ethers.formatEther(refundWei)

      heldTokens.push({
        chainId: chain_id,
        symbol,
        balanceRaw: ethers.formatUnits(balanceWei, 18),
        tokensValueEth, // string ETH
      })

      totalValueEth += parseFloat(tokensValueEth)
    }
  }

  return {
    updated: true,
    totalValueEth: totalValueEth.toFixed(6),
    createdTokens,
    heldTokens,
  }
}



