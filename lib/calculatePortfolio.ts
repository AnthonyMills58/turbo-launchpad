import { ethers } from 'ethers'
import db from './db'
import TurboTokenABI from './abi/TurboToken.json'
import { PortfolioData, CreatedTokenInfo, HeldTokenInfo } from '../types/portfolio'
import { megaethMainnet, megaethTestnet, sepoliaTestnet} from './chains'

// 🔹 Helper for network
const rpcUrlsByChainId: Record<number, string> = {
  6342: megaethTestnet.rpcUrls.default.http[0],
  9999: megaethMainnet.rpcUrls.default.http[0],
  11155111: sepoliaTestnet.rpcUrls.default.http[0],
}


// 🔹 Bonding curve sell price formula (off-chain)
function getSellPrice(
  amount: bigint,
  currentPrice: bigint,
  slope: bigint
): bigint {
  if (amount === 0n) return 0n
  const c2 = currentPrice - (slope * amount) / 10n ** 18n
  const avgPrice = (currentPrice + c2) / 2n
  const total = (amount * avgPrice) / 10n ** 18n
  return total
}

export async function calculatePortfolio(wallet: string): Promise<PortfolioData> {
  const allTokens = await db.query(`SELECT * FROM tokens`)

  const createdTokens: CreatedTokenInfo[] = []
  const heldTokens: HeldTokenInfo[] = []

  let totalValueEth = 0

  for (const token of allTokens.rows) {
    const {
      creator_wallet,
      contract_address,
      chain_id,
      total_supply,
      creator_lock_amount,
      current_price,
      slope,
      symbol,
    } = token

    const rpcUrl = rpcUrlsByChainId[chain_id]
    if (!rpcUrl) continue

    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const contract = new ethers.Contract(contract_address, TurboTokenABI.abi, provider)

    const balanceRaw = await contract.balanceOf(wallet)
    const balance = BigInt(balanceRaw.toString())

    // 🔹 User is the creator
    if (creator_wallet && creator_wallet.toLowerCase() === wallet.toLowerCase()) {
      const othersHold = (total_supply - creator_lock_amount)

      createdTokens.push({
        chainId: chain_id,
        symbol,
        othersHoldRaw: othersHold.toString(),
        contractEthBalance: ethers.formatEther(await provider.getBalance(contract_address)),
      })
    }

    // 🔹 User holds tokens (including if also creator)
    if (balance > 0n) {
      const price = getSellPrice(
        balance,
        ethers.parseUnits(current_price.toString(), 18),
        BigInt(slope)
      )
      const tokensValueEth = ethers.formatEther(price)

      heldTokens.push({
        chainId: chain_id,
        symbol,
        balanceRaw: ethers.formatUnits(balance, 18),
        tokensValueEth,
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

