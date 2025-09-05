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

  // Cooldown-related
  min_token_age_for_unlock_seconds: number
  creator_unlock_time: number | null

  // NEW: lifetime lock model
  creator_locking_closed: boolean
  creator_lock_cumulative: number | null
}

// RPCs by chain
const rpcUrlsByChainId: Record<number, string> = {
  6342: megaethTestnet.rpcUrls.default.http[0],
  9999: megaethMainnet.rpcUrls.default.http[0],
  11155111: sepoliaTestnet.rpcUrls.default.http[0],
}

// DISABLED: Provider cache and getProvider function removed
// These were only used by the removed getTokenHoldersCount function

// DISABLED: getTokenHoldersCount function removed
// Holder count is now only calculated on manual user request via /api/token-holders

/**
 * Syncs a token's on-chain state to the database
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

      // Cooldown-related (guard for legacy)
      creatorUnlockTimeRaw,
      minTokenAgeSecsRaw,

      // NEW lifetime-lock fields (guard for legacy)
      lockClosedRaw,
      lockCumRaw,
    ] = await Promise.all([
      contract.tokenInfo(),
      contract.getCurrentPrice(),
      contract.airdropFinalized(),
      contract.totalSupply(),
      contract.unclaimedAirdropAmount(),
      contract.creatorUnlockTime().catch(() => 0n),
      contract.minTokenAgeForUnlockSeconds().catch(() => 0n),
      contract.creatorLockingClosed?.().catch?.(() => false) ?? Promise.resolve(false),
      contract.creatorLockCumulative?.().catch?.(() => 0n) ?? Promise.resolve(0n),
    ])

    // DISABLED: Automatic holder count fetching in sync
    // Previously: Fetched holder count during sync
    // Now: Holder count only fetched on manual user request

    const totalSupply = Number(totalSupplyRaw) / 1e18
    const currentPrice = Number(ethers.formatEther(currentPriceRaw))
    const creatorLockAmount = Number(tokenInfoRaw._creatorLockAmount) / 1e18
    const totalRaised = Number(ethers.formatEther(tokenInfoRaw._totalRaised))
    const basePrice = Number(tokenInfoRaw._basePrice)
    const slope = Number(tokenInfoRaw._slope)
    const graduated = tokenInfoRaw._graduated as boolean
    const airdrop_allocations_sum = parseFloat(ethers.formatUnits(unclaimedAirdropAmountRaw, 18))

    const fdv = totalSupply * currentPrice
    const marketCap = (totalSupply - creatorLockAmount) * currentPrice

    // Airdrops
    const airdropAllocations: Record<string, { amount: number; claimed: boolean }> = {}
    if (airdropFinalized) {
      const [recipients, amounts]: [string[], bigint[]] = await contract.getAirdropAllocations()
      for (let i = 0; i < recipients.length; i++) {
        const addr = recipients[i]
        const amtReadable = parseFloat(formatUnits(amounts[i], 18))
        const claimed = await contract.airdropClaimed(addr)
        airdropAllocations[addr] = { amount: amtReadable, claimed }
      }
    }

    // Cooldown fields (legacy-safe)
    const creatorUnlockTime = creatorUnlockTimeRaw ? Number(creatorUnlockTimeRaw) : null
    const minAgeSecs =
      minTokenAgeSecsRaw && Number(minTokenAgeSecsRaw) > 0
        ? Number(minTokenAgeSecsRaw)
        : 172800 // default 2 days for legacy

    // NEW: lifetime lock model (legacy-safe)
    const creatorLockingClosed =
      typeof lockClosedRaw === 'boolean' ? lockClosedRaw : Boolean(lockClosedRaw)
    const creatorLockCumulative =
      typeof lockCumRaw === 'bigint' ? parseFloat(ethers.formatUnits(lockCumRaw, 18)) : null

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

      min_token_age_for_unlock_seconds: minAgeSecs,
      creator_unlock_time: creatorUnlockTime,

      creator_locking_closed: creatorLockingClosed,
      creator_lock_cumulative: creatorLockCumulative,
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
        creator_unlock_time = $15,
        creator_locking_closed = $16,
        creator_lock_cumulative = $17
       WHERE id = $18`,
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
        syncFields.creator_locking_closed,
        syncFields.creator_lock_cumulative,
        tokenId,
      ]
    )

    console.log(`✅ Synced token ID ${tokenId}`)
  } catch (error) {
    console.error(`❌ Failed to sync token ID ${tokenId}:`, error)
    throw error
  }
}







