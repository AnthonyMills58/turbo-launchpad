import { ethers, formatUnits } from 'ethers'
import TurboTokenABI from './abi/TurboToken.json'
import db from './db'
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from './chains'

type SyncFields = {
  current_price: number
  fdv: number
  market_cap: number
  total_supply: number
  creator_lock_amount: number
  airdrop_finalized: boolean
  airdrop_allocations: Record<string, { amount: number; claimed: boolean }>
  airdrop_allocations_sum: number
  last_synced_at: string
  total_raised: number
  base_price: number
  slope: number
  graduated: boolean

  // NEW: cooldown-related
  min_token_age_for_unlock_seconds: number
  creator_unlock_time: number | null
}

// ✅ Map chain IDs to their RPC URLs
const rpcUrlsByChainId: Record<number, string> = {
  6342: megaethTestnet.rpcUrls.default.http[0],
  9999: megaethMainnet.rpcUrls.default.http[0],
  11155111: sepoliaTestnet.rpcUrls.default.http[0],
}

/**
 * Syncs a token's on-chain state to the database
 * @param contractAddress Contract address of the token
 * @param tokenId Corresponding token ID in the DB
 * @param chainId Network the token lives on
 */
export async function syncTokenState(
  contractAddress: string,
  tokenId: number,
  chainId: number
): Promise<void> {
  const rpcUrl = rpcUrlsByChainId[chainId]
  if (!rpcUrl) throw new Error(`Unsupported chain ID: ${chainId}`)

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const contract = new ethers.Contract(contractAddress, TurboTokenABI.abi, provider)

  try {
    const [
      tokenInfoRaw,
      currentPriceRaw,
      airdropFinalized,
      totalSupplyRaw,
      unclaimedAirdropAmountRaw,

      // NEW: read cooldown fields from chain
      creatorUnlockTimeRaw,
      minTokenAgeSecsRaw,
    ] = await Promise.all([
      contract.tokenInfo(),
      contract.getCurrentPrice(),
      contract.airdropFinalized(),
      contract.totalSupply(),
      contract.unclaimedAirdropAmount(),
      contract.creatorUnlockTime().catch(() => 0n),
      contract.minTokenAgeForUnlockSeconds().catch(() => 0n),
    ])

    const totalSupply = Number(totalSupplyRaw) / 1e18
    const currentPrice = Number(ethers.formatEther(currentPriceRaw))
    const creatorLockAmount = Number(tokenInfoRaw._creatorLockAmount) / 1e18
    const totalRaised = Number(ethers.formatEther(tokenInfoRaw._totalRaised))
    const basePrice = Number(tokenInfoRaw._basePrice)
    const slope = Number(tokenInfoRaw._slope)
    const graduated = tokenInfoRaw._graduated as boolean
    const airdrop_allocations_sum = parseFloat(ethers.formatUnits(unclaimedAirdropAmountRaw, 18))

    // fdv/marketcap (your current approach)
    const fdv = totalSupply * currentPrice
    const marketCap = (totalSupply - creatorLockAmount) * currentPrice

    // Airdrop allocations (unchanged)
    const airdropAllocations: Record<string, { amount: number; claimed: boolean }> = {}
    if (airdropFinalized) {
      const [recipients, amounts]: [string[], bigint[]] = await contract.getAirdropAllocations()
      for (let i = 0; i < recipients.length; i++) {
        const address = recipients[i]
        const raw = amounts[i]
        const readable = parseFloat(formatUnits(raw, 18))
        const claimed = await contract.airdropClaimed(address)
        airdropAllocations[address] = { amount: readable, claimed }
      }
    }

    // NEW: normalize cooldown fields (handle legacy contracts returning 0)
    const creatorUnlockTime = creatorUnlockTimeRaw ? Number(creatorUnlockTimeRaw) : null
    const minAgeSecs =
      minTokenAgeSecsRaw && Number(minTokenAgeSecsRaw) > 0
        ? Number(minTokenAgeSecsRaw)
        : 172800 // fallback 2d if the contract didn't have this yet

    const syncFields: SyncFields = {
      current_price: currentPrice,
      fdv,
      market_cap: marketCap,
      total_supply: totalSupply,
      creator_lock_amount: creatorLockAmount,
      airdrop_finalized: airdropFinalized,
      airdrop_allocations: airdropAllocations,
      last_synced_at: new Date().toISOString(),
      total_raised: totalRaised,
      base_price: basePrice,
      slope,
      graduated,
      airdrop_allocations_sum,

      // NEW
      min_token_age_for_unlock_seconds: minAgeSecs,
      creator_unlock_time: creatorUnlockTime,
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
        eth_raised = $9,
        base_price = $10,
        slope = $11,
        is_graduated = $12,
        airdrop_allocations_sum = $13,
        min_token_age_for_unlock_seconds = $14,
        creator_unlock_time = $15
       WHERE id = $16`,
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
        syncFields.base_price,
        syncFields.slope,
        syncFields.graduated,
        syncFields.airdrop_allocations_sum,
        syncFields.min_token_age_for_unlock_seconds,
        syncFields.creator_unlock_time,
        tokenId,
      ]
    )

    console.log(`✅ Synced token ID ${tokenId}`)
  } catch (error) {
    console.error(`❌ Failed to sync token ID ${tokenId}:`, error)
    throw error
  }
}






