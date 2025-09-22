import { ethers, formatUnits } from 'ethers'
import TurboTokenABI from './abi/TurboToken.json'
import db from './db'
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from './chains'
import { DEX_ROUTER_BY_CHAIN, routerAbi, factoryAbi, pairAbi } from './dex'

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

  // Aggregation fields (from worker calculations)
  holder_count: number
  volume_24h_eth: number
  liquidity_eth: number
  liquidity_usd: number
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
 * Gets DEX price for a graduated token
 */
async function getDexPrice(contractAddress: string, chainId: number): Promise<number> {
  console.log(`[getDexPrice] Starting price calculation for contract: ${contractAddress}, chainId: ${chainId}`)
  
  const rpcUrl = rpcUrlsByChainId[chainId]
  if (!rpcUrl) throw new Error(`Unsupported chain ID: ${chainId}`)

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const routerAddress = DEX_ROUTER_BY_CHAIN[chainId]
  const router = new ethers.Contract(routerAddress, routerAbi, provider)

  const factoryAddress = await router.factory()
  const wethAddress = await router.WETH()
  console.log(`[getDexPrice] Factory: ${factoryAddress}, WETH: ${wethAddress}`)
  
  const factory = new ethers.Contract(factoryAddress, factoryAbi, provider)
  const pairAddress = await factory.getPair(contractAddress, wethAddress)
  console.log(`[getDexPrice] LP Pool Address: ${pairAddress}`)

  if (!pairAddress || pairAddress === ethers.ZeroAddress) {
    throw new Error('No DEX pair found')
  }

  const pair = new ethers.Contract(pairAddress, pairAbi, provider)
  const [reserve0, reserve1] = await pair.getReserves()
  const token0 = await pair.token0()
  const token1 = await pair.token1()
  
  console.log(`[getDexPrice] Token0: ${token0}, Token1: ${token1}`)
  console.log(`[getDexPrice] Reserve0: ${reserve0.toString()}, Reserve1: ${reserve1.toString()}`)

  const isWeth0 = token0.toLowerCase() === wethAddress.toLowerCase()
  const reserveETH = isWeth0 ? reserve0 : reserve1
  const reserveToken = isWeth0 ? reserve1 : reserve0
  
  console.log(`[getDexPrice] WETH is token0: ${isWeth0}`)
  console.log(`[getDexPrice] ETH Reserve: ${reserveETH.toString()}, Token Reserve: ${reserveToken.toString()}`)

  const tokenContract = new ethers.Contract(contractAddress, TurboTokenABI.abi, provider)
  const decimals = await tokenContract.decimals()
  console.log(`[getDexPrice] Token decimals: ${decimals}`)

  const tokenAmount = Number(ethers.formatUnits(reserveToken, decimals))
  const ethAmount = Number(ethers.formatUnits(reserveETH, 18))
  
  console.log(`[getDexPrice] Parsed Token Amount: ${tokenAmount}`)
  console.log(`[getDexPrice] Parsed ETH Amount: ${ethAmount}`)

  if (tokenAmount === 0) {
    throw new Error('Token reserve is 0')
  }

  const price = ethAmount / tokenAmount
  console.log(`[getDexPrice] ✅ Calculated DEX price (ETH/token): ${price}`)
  
  return price
}

/**
 * Syncs a token's on-chain state to the database
 */
export async function syncTokenState(
  contractAddress: string,
  tokenId: number,
  chainId: number
): Promise<void> {
  console.log(`[syncTokenState] Starting sync for token ID: ${tokenId}, contract: ${contractAddress}, chainId: ${chainId}`)
  
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

    const totalSupply = Number(totalSupplyRaw) // Keep in wei for database storage (includes locked tokens for FDV)
    const creatorLockAmount = Number(tokenInfoRaw._creatorLockAmount) / 1e18
    const totalRaised = Number(ethers.formatEther(tokenInfoRaw._totalRaised))
    const basePrice = Number(tokenInfoRaw._basePrice)
    const slope = Number(tokenInfoRaw._slope)
    const graduated = tokenInfoRaw._graduated as boolean
    const airdrop_allocations_sum = parseFloat(ethers.formatUnits(unclaimedAirdropAmountRaw, 18))
    
    console.log(`[syncTokenState] Token graduation status: ${graduated}`)
    console.log(`[syncTokenState] Contract price raw: ${currentPriceRaw.toString()}`)
    console.log(`[syncTokenState] Contract price formatted: ${Number(ethers.formatEther(currentPriceRaw))}`)

    // Price calculation: DEX price for graduated tokens, contract price for non-graduated
    let currentPrice: number
    if (graduated) {
      // For graduated tokens, try to get DEX price
      console.log(`[syncTokenState] Token is graduated, attempting to get DEX price for contract: ${contractAddress}`)
      console.log(`[syncTokenState] NOTE: Using contract address to find LP pool via factory.getPair() instead of dex_pools table`)
      console.log(`[syncTokenState] This ensures we get the current on-chain LP pool address, not a potentially stale database record`)
      
      try {
        currentPrice = await getDexPrice(contractAddress, chainId)
        console.log(`[syncTokenState] ✅ Successfully got DEX price: ${currentPrice}`)
      } catch (error) {
        console.warn(`[syncTokenState] Failed to get DEX price for graduated token ${contractAddress}, falling back to contract price:`, error)
        currentPrice = Number(ethers.formatEther(currentPriceRaw))
        console.log(`[syncTokenState] Using fallback contract price: ${currentPrice}`)
      }
    } else {
      // For non-graduated tokens, use contract bonding curve price
      console.log(`[syncTokenState] Token is not graduated, using contract bonding curve price`)
      currentPrice = Number(ethers.formatEther(currentPriceRaw))
      console.log(`[syncTokenState] Contract price: ${currentPrice}`)
    }

    // FDV and Market Cap calculation
    let fdv: number
    let marketCap: number
    
    if (graduated) {
      // For graduated tokens, read FDV and market cap from database (calculated by worker)
      // This avoids heavy blockchain scanning in sync procedures
      const { rows } = await db.query(
        'SELECT fdv, market_cap FROM tokens WHERE id = $1',
        [tokenId]
      )
      fdv = rows[0]?.fdv || 0
      marketCap = rows[0]?.market_cap || 0
    } else {
      // For pre-graduation tokens, calculate FDV and market cap
      // Convert totalSupply from wei to tokens for calculations
      const totalSupplyTokens = totalSupply / 1e18
      fdv = totalSupplyTokens * currentPrice
      
      // Simple contract-based calculation (fast)
      const creatorLockWei = BigInt(Math.floor(creatorLockAmount * 1e18))
      const circulatingSupplyWei = BigInt(Math.floor(totalSupply)) - creatorLockWei
      const circulatingSupply = Number(circulatingSupplyWei) / 1e18
      marketCap = circulatingSupply * currentPrice
    }

    // Fetch additional fields from database (calculated by aggregation worker)
    const { rows: aggRows } = await db.query(
      'SELECT holder_count, volume_24h_eth, liquidity_eth, liquidity_usd FROM tokens WHERE id = $1',
      [tokenId]
    )
    const holderCount = aggRows[0]?.holder_count || 0
    const volume24hEth = aggRows[0]?.volume_24h_eth || 0
    const liquidityEth = aggRows[0]?.liquidity_eth || 0
    const liquidityUsd = aggRows[0]?.liquidity_usd || 0

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

      // Aggregation fields (from worker calculations)
      holder_count: holderCount,
      volume_24h_eth: volume24hEth,
      liquidity_eth: liquidityEth,
      liquidity_usd: liquidityUsd,
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







