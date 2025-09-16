import 'dotenv/config'
import pool from '../lib/db'
import { 
  TOKEN_ID, 
  TOKEN_ID_FROM, 
  TOKEN_ID_TO, 
  CHAIN_ID_FILTER, 
  GRADUATED_ONLY, 
  UNGRADUATED_ONLY, 
  HAS_TEST_FILTERS 
} from './core/config'

// Aggregation configuration
const DAILY_AGG_UPDATE_DAYS = Number(process.env.DAILY_AGG_UPDATE_DAYS ?? 12)  // Update last 12 days by default (covers oldest token)
const CANDLES_UPDATE_HOURS = Number(process.env.CANDLES_UPDATE_HOURS ?? 24)   // Update last 24 hours by default

/**
 * Aggregation Worker
 * 
 * Processes token_transfers to update:
 * 1. token_balances table
 * 2. token_candles (1-minute intervals)
 * 3. token_daily_agg (daily aggregations)
 * 4. tokens table (holder_count, current stats)
 */

interface TokenRow {
  id: number
  chain_id: number
  contract_address: string
  deployment_block: number
  last_processed_block: number
  is_graduated: boolean
  creator_wallet: string
}

interface TransferRow {
  token_id: number
  chain_id: number
  block_number: number
  block_time: Date
  from_address: string
  to_address: string
  amount_wei: string
  amount_eth_wei: string | null
  price_eth_per_token: number | null
  side: string
  src: string
}



/**
 * Process token daily aggregations
 */
async function processTokenDailyAgg(
  token: TokenRow,
  chainId: number
): Promise<void> {
  console.log(`\n📊 Processing token ${token.id} (${token.contract_address}) for daily aggregations (last ${DAILY_AGG_UPDATE_DAYS} days)...`)
  
  // Calculate the cutoff date for incremental updates
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - DAILY_AGG_UPDATE_DAYS)
  
  // Get transfers for this token, grouped by day (only recent days)
  const { rows: dailyData } = await pool.query(`
    SELECT 
      DATE(block_time) as day,
      COUNT(*) as transfers,
      COUNT(DISTINCT from_address) as unique_senders,
      COUNT(DISTINCT to_address) as unique_receivers,
      COUNT(DISTINCT CASE 
        WHEN from_address != '0x0000000000000000000000000000000000000000' 
        THEN from_address 
      END) + COUNT(DISTINCT CASE 
        WHEN to_address != '0x0000000000000000000000000000000000000000' 
        THEN to_address 
      END) as unique_traders,
      SUM(amount_wei::numeric) as volume_token_wei,
      SUM(COALESCE(amount_eth_wei::numeric, 0)) as volume_eth_wei,
      SUM(COALESCE(amount_eth_wei::numeric, 0) * COALESCE(eth_price_usd, 0)) as volume_usd
    FROM public.token_transfers 
    WHERE token_id = $1 AND chain_id = $2
      AND block_time >= $3
    GROUP BY DATE(block_time)
    ORDER BY day ASC
  `, [token.id, chainId, cutoffDate])
  
  console.log(`Token ${token.id}: Found ${dailyData.length} days to process (last ${DAILY_AGG_UPDATE_DAYS} days)`)
  
  if (dailyData.length === 0) {
    console.log(`Token ${token.id}: No recent daily data found. Skipping.`)
    return
  }
  
  // Clear existing daily aggregations for this token (only recent days)
  await pool.query(`
    DELETE FROM public.token_daily_agg 
    WHERE token_id = $1 AND chain_id = $2 AND day >= $3
  `, [token.id, chainId, cutoffDate])
  
  // Insert daily aggregations
  for (const dayData of dailyData) {
    // Get holder count for this day (end of day)
    const { rows: [{ holders_count }] } = await pool.query(`
      SELECT COUNT(DISTINCT holder)::int as holders_count
      FROM public.token_balances
      WHERE token_id = $1 AND chain_id = $2
        AND balance_wei::numeric > 0
        AND holder != '0x0000000000000000000000000000000000000000'
        AND LOWER(holder) NOT IN (
          SELECT LOWER(pair_address) FROM public.dex_pools WHERE chain_id = $2
        )
    `, [token.id, chainId])
    
    await pool.query(`
      INSERT INTO public.token_daily_agg 
      (token_id, chain_id, day, transfers, unique_senders, unique_receivers, 
       unique_traders, volume_token_wei, volume_eth_wei, volume_usd, holders_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      -- ON CONFLICT removed - table may not have unique constraint
    `, [
      token.id, chainId, dayData.day, dayData.transfers, 
      dayData.unique_senders, dayData.unique_receivers, dayData.unique_traders,
      dayData.volume_token_wei, dayData.volume_eth_wei, dayData.volume_usd,
      holders_count
    ])
  }
  
  console.log(`✅ Token ${token.id}: Processed ${dailyData.length} daily aggregations`)
}

/**
 * Process token candles (1-minute intervals)
 */
async function processTokenCandles(
  token: TokenRow,
  chainId: number
): Promise<void> {
  console.log(`\n🕯️ Processing token ${token.id} (${token.contract_address}) for 1-minute candles (last ${CANDLES_UPDATE_HOURS} hours)...`)
  
  // Calculate the cutoff time for incremental updates
  const cutoffTime = new Date()
  cutoffTime.setHours(cutoffTime.getHours() - CANDLES_UPDATE_HOURS)
  
  // Get transfers for this token, grouped by 1-minute intervals (only recent hours)
  const { rows: candleData } = await pool.query(`
    SELECT 
      DATE_TRUNC('minute', block_time) as ts,
      COUNT(*) as trades_count,
      SUM(amount_wei::numeric) as volume_token_wei,
      SUM(COALESCE(amount_eth_wei::numeric, 0)) as volume_eth_wei,
      SUM(COALESCE(amount_eth_wei::numeric, 0) * COALESCE(eth_price_usd, 0)) as volume_usd,
      MIN(COALESCE(price_eth_per_token, 0)) as low_price,
      MAX(COALESCE(price_eth_per_token, 0)) as high_price,
      (ARRAY_AGG(COALESCE(price_eth_per_token, 0) ORDER BY block_time ASC))[1] as open_price,
      (ARRAY_AGG(COALESCE(price_eth_per_token, 0) ORDER BY block_time DESC))[1] as close_price
    FROM public.token_transfers 
    WHERE token_id = $1 AND chain_id = $2
      AND block_time >= $3
      AND price_eth_per_token IS NOT NULL
      AND price_eth_per_token > 0
    GROUP BY DATE_TRUNC('minute', block_time)
    ORDER BY ts ASC
  `, [token.id, chainId, cutoffTime])
  
  console.log(`Token ${token.id}: Found ${candleData.length} 1-minute candles to process (last ${CANDLES_UPDATE_HOURS} hours)`)
  
  if (candleData.length === 0) {
    console.log(`Token ${token.id}: No recent candle data found. Skipping.`)
    return
  }
  
  // Clear existing candles for this token (only recent hours)
  await pool.query(`
    DELETE FROM public.token_candles 
    WHERE token_id = $1 AND chain_id = $2 AND interval = '1m' AND ts >= $3
  `, [token.id, chainId, cutoffTime])
  
  // Insert candles
  for (const candle of candleData) {
    await pool.query(`
      INSERT INTO public.token_candles 
      (token_id, chain_id, interval, ts, open, high, low, close, 
       volume_token_wei, volume_eth_wei, volume_usd, trades_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      -- ON CONFLICT removed - table may not have unique constraint
    `, [
      token.id, chainId, '1m', candle.ts, 
      candle.open_price, candle.high_price, candle.low_price, candle.close_price,
      candle.volume_token_wei, candle.volume_eth_wei, candle.volume_usd, candle.trades_count
    ])
  }
  
  console.log(`✅ Token ${token.id}: Processed ${candleData.length} 1-minute candles`)
}

/**
 * Process token balances from transfers
 */
async function processTokenBalances(
  token: TokenRow,
  chainId: number
): Promise<void> {
  console.log(`\n🪙 Processing token ${token.id} (${token.contract_address}) for balances...`)
  
  // Get ALL transfers for this token from the beginning (no block filtering)
  const { rows: transfers } = await pool.query<TransferRow>(`
    SELECT token_id, chain_id, block_number, block_time, from_address, to_address, 
           amount_wei, amount_eth_wei, price_eth_per_token, side, src
    FROM public.token_transfers 
    WHERE token_id = $1 AND chain_id = $2
    ORDER BY block_number ASC, log_index ASC
  `, [token.id, chainId])
  
  console.log(`Token ${token.id}: Found ${transfers.length} transfers to process`)
  
  if (transfers.length === 0) {
    console.log(`Token ${token.id}: No transfers found. Skipping.`)
    return
  }
  
  // Clear existing balances for this token to start fresh
  await pool.query(`
    DELETE FROM public.token_balances 
    WHERE token_id = $1 AND chain_id = $2
  `, [token.id, chainId])
  
  // Calculate cumulative balances using SQL aggregation
  await pool.query(`
    INSERT INTO public.token_balances (token_id, chain_id, holder, balance_wei)
    SELECT 
      $1 as token_id,
      $2 as chain_id,
      holder,
      SUM(balance_change) as balance_wei
    FROM (
      -- Subtract from 'from' addresses
      SELECT 
        LOWER(from_address) as holder,
        -amount_wei::numeric as balance_change
      FROM public.token_transfers 
      WHERE token_id = $1 AND chain_id = $2
        AND from_address != '0x0000000000000000000000000000000000000000'
        AND amount_wei != '0'
      
      UNION ALL
      
      -- Add to 'to' addresses  
      SELECT 
        LOWER(to_address) as holder,
        amount_wei::numeric as balance_change
      FROM public.token_transfers 
      WHERE token_id = $1 AND chain_id = $2
        AND to_address != '0x0000000000000000000000000000000000000000'
        AND amount_wei != '0'
    ) balance_changes
    GROUP BY holder
    HAVING SUM(balance_change) > 0
  `, [token.id, chainId])
  
  // Clean up zero balances
  await pool.query(`
    DELETE FROM public.token_balances 
    WHERE token_id = $1 AND chain_id = $2 AND balance_wei::numeric <= 0
  `, [token.id, chainId])
  
  // Get LP pool addresses to exclude from holder count
  const { rows: lpAddresses } = await pool.query<{ pair_address: string }>(`
    SELECT pair_address FROM public.dex_pools WHERE chain_id = $1
  `, [chainId])
  const lpAddressSet = new Set(lpAddresses.map(row => row.pair_address.toLowerCase()))
  
  // Update holder count (exclude LP pools, zero address, and token contract address)
  const { rows: [{ holders }] } = await pool.query(`
    SELECT COUNT(*)::int AS holders
    FROM public.token_balances
    WHERE token_id = $1 AND chain_id = $2 
      AND balance_wei::numeric > 0
      AND holder != '0x0000000000000000000000000000000000000000'
      AND LOWER(holder) != LOWER($3)
      AND LOWER(holder) NOT IN (${Array.from(lpAddressSet).map(addr => `'${addr}'`).join(',')})
  `, [token.id, chainId, token.contract_address])
  
  await pool.query(`
    UPDATE public.tokens
    SET holder_count = $1, holder_count_updated_at = NOW()
    WHERE id = $2
  `, [holders, token.id])
  
  console.log(`✅ Token ${token.id}: Updated balances, holders: ${holders}`)
}

/**
 * Process token statistics (current_price, market_cap, fdv, total_supply, liquidity, 24h volume)
 */
async function processTokenStats(
  token: TokenRow,
  chainId: number
): Promise<void> {
  console.log(`\n📈 Processing token ${token.id} (${token.contract_address}) for statistics...`)
  
  // Get current price from latest pair_snapshots
  const { rows: priceData } = await pool.query(`
    SELECT 
      ps.price_eth_per_token,
      ps.reserve0_wei,
      ps.reserve1_wei,
      dp.quote_token,
      dp.token0,
      dp.token1
    FROM public.pair_snapshots ps
    JOIN public.dex_pools dp ON ps.pair_address = dp.pair_address
    WHERE dp.token_id = $1 AND dp.chain_id = $2
    ORDER BY ps.block_number DESC
    LIMIT 1
  `, [token.id, chainId])
  
  let current_price = 0
  let liquidity_eth = 0
  
  if (priceData.length > 0) {
    const price = priceData[0]
    current_price = Number(price.price_eth_per_token) || 0
    
    // Calculate liquidity (quote token reserves)
    if (price.quote_token.toLowerCase() === price.token0.toLowerCase()) {
      liquidity_eth = Number(price.reserve0_wei) / 1e18
    } else {
      liquidity_eth = Number(price.reserve1_wei) / 1e18
    }
  }
  
  // Get current ETH price for USD calculations
  const { rows: ethPriceData } = await pool.query(`
    SELECT price_usd FROM public.eth_price_cache 
    ORDER BY created_at DESC LIMIT 1
  `)
  const eth_price_usd = ethPriceData.length > 0 ? Number(ethPriceData[0].price_usd) : 0
  
  const liquidity_usd = liquidity_eth * eth_price_usd
  
  // Calculate circulating supply (excludes LP pools and zero address)
  const { rows: [{ circulating_supply }] } = await pool.query(`
    SELECT COALESCE(SUM(balance_wei::numeric), 0) as circulating_supply
    FROM public.token_balances
    WHERE token_id = $1 AND chain_id = $2
      AND holder != '0x0000000000000000000000000000000000000000'
      AND LOWER(holder) NOT IN (
        SELECT LOWER(pair_address) FROM public.dex_pools WHERE chain_id = $2
      )
  `, [token.id, chainId])
  
  // Calculate total supply (includes LP pools, excludes zero address)
  const { rows: [{ total_supply }] } = await pool.query(`
    SELECT COALESCE(SUM(balance_wei::numeric), 0) as total_supply
    FROM public.token_balances
    WHERE token_id = $1 AND chain_id = $2
      AND holder != '0x0000000000000000000000000000000000000000'
  `, [token.id, chainId])
  
  // Calculate 24h volume
  const { rows: [{ volume_24h_eth }] } = await pool.query(`
    SELECT COALESCE(SUM(amount_eth_wei::numeric), 0) / 1e18 as volume_24h_eth
    FROM public.token_transfers
    WHERE token_id = $1 AND chain_id = $2
      AND block_time >= NOW() - INTERVAL '24 hours'
      AND amount_eth_wei IS NOT NULL
  `, [token.id, chainId])
  
  const volume_24h_usd = Number(volume_24h_eth) * eth_price_usd
  
  // Calculate market cap and FDV
  const circulating_supply_tokens = Number(circulating_supply) / 1e18
  const total_supply_tokens = Number(total_supply) / 1e18
  
  const market_cap = circulating_supply_tokens * current_price * eth_price_usd
  const fdv = total_supply_tokens * current_price * eth_price_usd
  
  // Update tokens table
  await pool.query(`
    UPDATE public.tokens 
    SET 
      current_price = $1,
      market_cap = $2,
      fdv = $3,
      total_supply = $4,
      liquidity_eth = $5,
      liquidity_usd = $6,
      volume_24h_eth = $7,
      volume_24h_usd = $8,
      volume_24h_updated_at = NOW(),
      updated_at = NOW()
    WHERE id = $9 AND chain_id = $10
  `, [
    current_price, market_cap, fdv, total_supply,
    liquidity_eth, liquidity_usd, volume_24h_eth, volume_24h_usd,
    token.id, chainId
  ])
  
  console.log(`✅ Token ${token.id}: Updated statistics - Price: ${current_price}, Market Cap: $${market_cap.toFixed(2)}, FDV: $${fdv.toFixed(2)}`)
}

/**
 * Process a single token
 */
async function processToken(token: TokenRow, chainId: number): Promise<void> {
  console.log(`\n🪙 Processing token ${token.id} (${token.contract_address})...`)
  
  try {
    // Process token balances (processes ALL transfers from the beginning)
    await processTokenBalances(token, chainId)
    
    // Process daily aggregations
    await processTokenDailyAgg(token, chainId)
    
    // Process 1-minute candles
    await processTokenCandles(token, chainId)
    
    // Process token statistics
    await processTokenStats(token, chainId)
    
    console.log(`✅ Token ${token.id}: Completed all aggregations`)
    
  } catch (error) {
    console.error(`❌ Token ${token.id}: Error processing:`, error)
    throw error
  }
}

/**
 * Process a single chain
 */
async function processChain(chainId: number): Promise<void> {
  console.log(`🔗 Setting up provider for chain ${chainId}...`)
  
  // Apply chain filter if specified
  if (CHAIN_ID_FILTER && CHAIN_ID_FILTER !== chainId) {
    console.log(`📊 Skipping chain ${chainId} (filtered to chain ${CHAIN_ID_FILTER})`)
    return
  }

  console.log(`📊 Processing tokens for chain ${chainId}...`)
  
  // Build the WHERE clause based on filters
  const whereConditions: string[] = ['chain_id = $1']
  const params: (string | number)[] = [chainId]
  let paramIndex = 2

  // Token ID filter (highest priority)
  if (TOKEN_ID) {
    whereConditions.push(`id = $${paramIndex}`)
    params.push(TOKEN_ID)
    paramIndex++
    console.log(`📊 Filtering to token ID: ${TOKEN_ID}`)
  }
  // Token range filter
  else if (TOKEN_ID_FROM || TOKEN_ID_TO) {
    if (TOKEN_ID_FROM) {
      whereConditions.push(`id >= $${paramIndex}`)
      params.push(TOKEN_ID_FROM)
      paramIndex++
    }
    if (TOKEN_ID_TO) {
      whereConditions.push(`id <= $${paramIndex}`)
      params.push(TOKEN_ID_TO)
      paramIndex++
    }
    console.log(`📊 Filtering to token range: ${TOKEN_ID_FROM || 'any'} to ${TOKEN_ID_TO || 'any'}`)
  }

  // Graduation status filter
  if (GRADUATED_ONLY) {
    whereConditions.push(`is_graduated = true`)
    console.log(`📊 Filtering to graduated tokens only`)
  } else if (UNGRADUATED_ONLY) {
    whereConditions.push(`is_graduated = false`)
    console.log(`📊 Filtering to ungraduated tokens only`)
  }

  const whereClause = whereConditions.join(' AND ')
  
  const { rows: tokens } = await pool.query<TokenRow>(`
    SELECT id, chain_id, contract_address, deployment_block, last_processed_block, is_graduated, creator_wallet
    FROM public.tokens 
    WHERE ${whereClause}
    ORDER BY id DESC
  `, params)
  
  console.log(`📊 Found ${tokens.length} tokens to process:`, tokens.map(t => t.id))
  
  // Process each token individually
  for (const token of tokens) {
    try {
      console.log(`\n🪙 Processing token ${token.id} (${token.contract_address})...`)
      await processToken(token, chainId)
    } catch (error) {
      console.error(`❌ Token ${token.id}: Failed to process:`, error)
    }
  }
}

/**
 * Main function
 */
async function main(): Promise<boolean> {
  console.log('🚀 Starting Aggregation Worker...')
  console.log('📋 Version: [400] - Token balances processing')
  
  try {
    // Get all supported chains
    const supportedChains = [6342, 11155111] // MegaETH, Sepolia
    
    let hasHealthyChains = false
    
    for (const chainId of supportedChains) {
      try {
        await processChain(chainId)
        hasHealthyChains = true
      } catch (error) {
        console.error(`❌ Chain ${chainId} failed:`, error)
      }
    }
    
    if (!hasHealthyChains) {
      console.log('❌ No healthy chains found')
      return false
    }
    
    console.log('✅ Aggregation Worker completed successfully!')
    return true
    
  } catch (error) {
    console.error('❌ Aggregation Worker failed:', error)
    return false
  }
}

// Run the worker
if (require.main === module) {
  if (HAS_TEST_FILTERS) {
    console.log('🧪 Test filters detected - running single cycle only')
    main().then(success => {
      if (!success) {
        console.log('🛑 Single cycle aborted')
      }
    }).catch(console.error)
  } else {
    console.log('🔄 No test filters - running single cycle only')
    main().then(success => {
      if (!success) {
        console.log('🛑 Single cycle aborted')
      }
    }).catch(console.error)
  }
}
