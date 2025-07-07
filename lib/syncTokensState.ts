import { ethers } from 'ethers'
import TurboTokenABI from './abi/TurboToken.json'
import db from './db'
import { megaethTestnet } from './chains'

type SyncFields = {
  current_price: number
  fdv: number
  market_cap: number
  total_supply: number
  creator_lock_amount: number
  airdrop_finalized: boolean
  airdrop_allocations: Record<string, { amount: number; claimed: boolean }>
  last_synced_at: string
  total_raised: number
}

/**
 * Syncs a token's on-chain state to the database
 * @param contractAddress Contract address of the token
 * @param tokenId Corresponding token ID in the DB
 */
export async function syncTokenState(contractAddress: string, tokenId: number): Promise<void> {
  const provider = new ethers.JsonRpcProvider(megaethTestnet.rpcUrls.default.http[0])
  const contract = new ethers.Contract(contractAddress, TurboTokenABI.abi, provider)

  try {
    const [
      tokenInfoRaw,
      currentPriceRaw,
      airdropFinalized,
      totalSupplyRaw
    ] = await Promise.all([
      contract.tokenInfo(),
      contract.getCurrentPrice(),
      contract.airdropFinalized(),
      contract.totalSupply()
    ])

    const totalSupply = Number(totalSupplyRaw)
    const maxSupply = Number(tokenInfoRaw._maxSupply) / 1e18
    const currentPrice = Number(ethers.formatEther(currentPriceRaw))
    const creatorLockAmount = Number(tokenInfoRaw._creatorLockAmount)
    const fdv = maxSupply * currentPrice
    const totalRaised = Number(ethers.formatEther(tokenInfoRaw._totalRaised))

    // --- Airdrop allocations + claimed/unclaimed ---
    const airdropAllocations: Record<string, { amount: number; claimed: boolean }> = {}
   

    if (airdropFinalized) {
      const [recipients, amounts]: [string[], bigint[]] = await contract.getAirdropAllocations()

      for (let i = 0; i < recipients.length; i++) {
        const address = recipients[i]
        const amount = Number(amounts[i])

        const claimed = await contract.airdropClaimed(address)
        airdropAllocations[address] = { amount, claimed }
      }
    }

    const marketCap = (totalSupply - creatorLockAmount) * currentPrice

    const syncFields: SyncFields = {
      current_price: currentPrice,
      fdv,
      market_cap: marketCap,
      total_supply: totalSupply,
      creator_lock_amount: creatorLockAmount,
      airdrop_finalized: airdropFinalized,
      airdrop_allocations: airdropAllocations,
      last_synced_at: new Date().toISOString(),
      total_raised: totalRaised
    }

    await db.query(
      `UPDATE tokens SET
        current_price = $1,
        fdv = $2,
        market_cap = $3,
        total_supply = $4,
        creator_lock_amount = $5,
        airdrop_finalized = $6,
        airdrop_allocations = $7,
        last_synced_at = $8,
        eth_raised = $9
       WHERE id = $10`,
      [
        syncFields.current_price,
        syncFields.fdv,
        syncFields.market_cap,
        syncFields.total_supply,
        syncFields.creator_lock_amount,
        syncFields.airdrop_finalized,
        JSON.stringify(syncFields.airdrop_allocations),
        syncFields.last_synced_at,
        syncFields.total_raised,
        tokenId
      ]
    )

    console.log(`✅ Synced token ID ${tokenId}`)
  } catch (error) {
    console.error(`❌ Failed to sync token ID ${tokenId}:`, error)
    throw error
  }
}




