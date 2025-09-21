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
const CHART_AGG_UPDATE_DAYS = Number(process.env.CHART_AGG_UPDATE_DAYS ?? 15)  // Update last 15 days by default (covers oldest token)

/**
 * Aggregation Worker
 * 
 * Processes token_transfers to update:
 * 1. token_balances table
 * 2. token_chart_agg (1m, 1d, 1w, 1M intervals with dual currency OHLC)
 * 3. tokens table (holder_count, current stats)
 */

interface TokenRow {
  id: number
  chain_id: number
  contract_address: string
  deployment_block: number
  last_processed_block: number
  is_graduated: boolean
  creator_wallet: string
  current_price?: number
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
 * Process token chart aggregations (1m, 1d, 1w, 1M intervals with dual currency OHLC)
 */
async function processTokenChartAgg(
  token: TokenRow,
  chainId: number
): Promise<void> {
  console.log(`\n📊 Processing token ${token.id} (${token.contract_address}) for chart aggregations (last ${CHART_AGG_UPDATE_DAYS} days)...`)
  
  // Calculate the cutoff date for incremental updates
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - CHART_AGG_UPDATE_DAYS)
  
  // Get trading data for this token (only transactions with ETH volume)
  const { rows: tradingData } = await pool.query(`
    SELECT 
      token_id,
      side,
      src,
      amount_eth_wei/1e18 as volume_eth,
      price_eth_per_token as price_eth,
      eth_price_usd,
      block_time
    FROM token_transfers 
    WHERE token_id = $1 
      AND chain_id = $2
      AND block_time >= $3
      AND amount_eth_wei IS NOT NULL 
      AND amount_eth_wei <> 0
      AND price_eth_per_token IS NOT NULL
      AND price_eth_per_token > 0
    ORDER BY block_time ASC
  `, [token.id, chainId, cutoffDate])
  
  console.log(`Token ${token.id}: Found ${tradingData.length} trading transactions to process (last ${CHART_AGG_UPDATE_DAYS} days)`)
  
  if (tradingData.length === 0) {
    console.log(`Token ${token.id}: No recent trading data found. Skipping.`)
    return
  }
  
  // Clear existing chart aggregations for this token (only recent days)
  await pool.query(`
    DELETE FROM public.token_chart_agg 
    WHERE token_id = $1 AND chain_id = $2 AND ts >= $3
  `, [token.id, chainId, cutoffDate])
  
  // Process 4-hour interval only
  const intervals = [
    { type: '4h', trunc: 'hour', interval: '4 hours' }
  ]
  
  for (const interval of intervals) {
    // Generate continuous time series with filled gaps
    const { rows: intervalData } = await pool.query(`
      WITH time_series AS (
        -- Generate continuous 4-hour intervals (00:00, 04:00, 08:00, 12:00, 16:00, 20:00)
        SELECT generate_series(
          DATE_TRUNC('day', $3::timestamp) + 
            (EXTRACT(hour FROM $3::timestamp)::int / 4) * interval '4 hours',
          DATE_TRUNC('day', NOW()) + interval '1 day' - interval '1 second',
          '4 hours'::interval
        ) as ts
      ),
      trading_data AS (
        -- Get actual trading data grouped by 4-hour intervals (matching time_series pattern)
        SELECT 
          DATE_TRUNC('day', block_time) + 
            (EXTRACT(hour FROM block_time)::int / 4) * interval '4 hours' as ts,
          COUNT(*) as trades_count,
          SUM(amount_eth_wei/1e18) as volume_eth,
          SUM((amount_eth_wei/1e18) * COALESCE(eth_price_usd, 0)) as volume_usd,
          MIN(price_eth_per_token) as price_low_eth,
          MAX(price_eth_per_token) as price_high_eth,
          (ARRAY_AGG(price_eth_per_token ORDER BY block_time ASC))[1] as price_open_eth,
          (ARRAY_AGG(price_eth_per_token ORDER BY block_time DESC))[1] as price_close_eth,
          (ARRAY_AGG(price_eth_per_token * COALESCE(eth_price_usd, 0) ORDER BY block_time ASC))[1] as price_open_usd,
          (ARRAY_AGG(price_eth_per_token * COALESCE(eth_price_usd, 0) ORDER BY block_time DESC))[1] as price_close_usd,
          MIN(price_eth_per_token * COALESCE(eth_price_usd, 0)) as price_low_usd,
          MAX(price_eth_per_token * COALESCE(eth_price_usd, 0)) as price_high_usd
        FROM token_transfers 
        WHERE token_id = $1 
          AND chain_id = $2
          AND block_time >= $3
          AND amount_eth_wei IS NOT NULL 
          AND amount_eth_wei <> 0
          AND price_eth_per_token IS NOT NULL
          AND price_eth_per_token > 0
        GROUP BY DATE_TRUNC('day', block_time) + 
          (EXTRACT(hour FROM block_time)::int / 4) * interval '4 hours'
      ),
      -- Get all trading data with prices for progressive forward-filling
      all_trades AS (
        SELECT 
          block_time,
          price_eth_per_token as price_eth,
          price_eth_per_token * COALESCE(eth_price_usd, 0) as price_usd
        FROM token_transfers 
        WHERE token_id = $1 
          AND chain_id = $2
          AND price_eth_per_token IS NOT NULL
          AND price_eth_per_token > 0
        ORDER BY block_time ASC
      ),
      -- Create price timeline for forward-filling
      price_timeline AS (
        SELECT 
          ts.ts,
          -- Get the last price before or at this timestamp
          (SELECT price_eth FROM all_trades 
           WHERE block_time <= ts.ts 
           ORDER BY block_time DESC 
           LIMIT 1) as forward_price_eth,
          (SELECT price_usd FROM all_trades 
           WHERE block_time <= ts.ts 
           ORDER BY block_time DESC 
           LIMIT 1) as forward_price_usd
        FROM time_series ts
      )
      -- Combine time series with trading data, filling gaps with zero volume and progressive forward-filled prices
      SELECT 
        ts.ts,
        COALESCE(td.trades_count, 0) as trades_count,
        COALESCE(td.volume_usd, 0) as volume_eth,
        COALESCE(td.volume_usd, 0) as volume_usd,
        -- For gaps: all OHLC prices equal to forward-filled price (flat candle)
        -- For actual data: use real OHLC values
        CASE 
          WHEN td.ts IS NULL THEN COALESCE(pt.forward_price_usd, 0)  -- Gap: flat candle with forward-filled price
          ELSE td.price_low_usd 
        END as price_low_eth,
        CASE 
          WHEN td.ts IS NULL THEN COALESCE(pt.forward_price_usd, 0)  -- Gap: flat candle with forward-filled price
          ELSE td.price_high_usd 
        END as price_high_eth,
        CASE 
          WHEN td.ts IS NULL THEN COALESCE(pt.forward_price_usd, 0)  -- Gap: flat candle with forward-filled price
          ELSE td.price_open_usd 
        END as price_open_eth,
        CASE 
          WHEN td.ts IS NULL THEN COALESCE(pt.forward_price_usd, 0)  -- Gap: flat candle with forward-filled price
          ELSE td.price_close_usd 
        END as price_close_eth,
        CASE 
          WHEN td.ts IS NULL THEN COALESCE(pt.forward_price_usd, 0)  -- Gap: flat candle with forward-filled price
          ELSE td.price_open_usd 
        END as price_open_usd,
        CASE 
          WHEN td.ts IS NULL THEN COALESCE(pt.forward_price_usd, 0)  -- Gap: flat candle with forward-filled price
          ELSE td.price_close_usd 
        END as price_close_usd,
        CASE 
          WHEN td.ts IS NULL THEN COALESCE(pt.forward_price_usd, 0)  -- Gap: flat candle with forward-filled price
          ELSE td.price_low_usd 
        END as price_low_usd,
        CASE 
          WHEN td.ts IS NULL THEN COALESCE(pt.forward_price_usd, 0)  -- Gap: flat candle with forward-filled price
          ELSE td.price_high_usd 
        END as price_high_usd
      FROM time_series ts
      LEFT JOIN trading_data td ON ts.ts = td.ts
      LEFT JOIN price_timeline pt ON ts.ts = pt.ts
      ORDER BY ts.ts ASC
    `, [token.id, chainId, cutoffDate])
    
    console.log(`Token ${token.id}: Found ${intervalData.length} ${interval.type} candles to process`)
    
    // Insert candles for this interval
    for (const candle of intervalData) {
      await pool.query(`
        INSERT INTO public.token_chart_agg 
        (token_id, chain_id, interval_type, ts, 
         price_open_eth, price_high_eth, price_low_eth, price_close_eth,
         price_open_usd, price_high_usd, price_low_usd, price_close_usd,
         volume_eth, volume_usd, trades_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `, [
        token.id, chainId, interval.type, candle.ts,
        candle.price_open_eth, candle.price_high_eth, candle.price_low_eth, candle.price_close_eth,
        candle.price_open_usd, candle.price_high_usd, candle.price_low_usd, candle.price_close_usd,
        candle.volume_eth, candle.volume_usd, candle.trades_count
      ])
    }
    
    console.log(`✅ Token ${token.id}: Processed ${intervalData.length} ${interval.type} candles`)
  }
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
      -- Subtract from 'from' addresses (unless from_address is zero address)
      SELECT 
        LOWER(from_address) as holder,
        -amount_wei::numeric as balance_change
      FROM public.token_transfers 
      WHERE token_id = $1 AND chain_id = $2
        AND amount_wei != '0'
        AND from_address != '0x0000000000000000000000000000000000000000'
      
      UNION ALL
      
      -- Add to 'to' addresses (unless to_address is zero address)
      SELECT 
        LOWER(to_address) as holder,
        amount_wei::numeric as balance_change
      FROM public.token_transfers 
      WHERE token_id = $1 AND chain_id = $2
        AND amount_wei != '0'
        AND to_address != '0x0000000000000000000000000000000000000000'
    ) balance_changes
    GROUP BY holder
    HAVING SUM(balance_change) != 0
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
    ORDER BY fetched_at DESC LIMIT 1
  `)
  const eth_price_usd = ethPriceData.length > 0 ? Number(ethPriceData[0].price_usd) : 0
  
  const liquidity_usd = liquidity_eth * eth_price_usd
  
  // Calculate circulating supply (excludes LP pools, excludes lock contracts, excludes zero address)
  const { rows: [{ circulating_supply }] } = await pool.query(`
    SELECT COALESCE(SUM(balance_wei::numeric), 0) as circulating_supply
    FROM public.token_balances
    WHERE token_id = $1 AND chain_id = $2
      AND holder != '0x0000000000000000000000000000000000000000'
      AND LOWER(holder) NOT IN (
        SELECT LOWER(pair_address) FROM public.dex_pools WHERE chain_id = $2
      )
      AND LOWER(holder) NOT IN (
        SELECT LOWER(contract_address) FROM public.tokens WHERE chain_id = $2
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
  
  // const volume_24h_usd = Number(volume_24h_eth) * eth_price_usd // Not used - column doesn't exist
  
  // Calculate market cap and FDV
  const circulating_supply_tokens = Number(circulating_supply) / 1e18
  const total_supply_tokens = Number(total_supply) / 1e18
  
  // Only update price-related fields if we have valid price data from pair_snapshots
  if (priceData.length > 0) {
    const market_cap = circulating_supply_tokens * current_price
    const fdv = total_supply_tokens * current_price
    
    // Update tokens table with price data
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
        volume_24h_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = $8 AND chain_id = $9
    `, [
      current_price, market_cap, fdv, total_supply, // total_supply is already in wei from token_balances
      liquidity_eth, liquidity_usd, volume_24h_eth,
      token.id, chainId
    ])
    
    console.log(`✅ Token ${token.id}: Updated statistics - Price: ${current_price}, Market Cap: $${market_cap.toFixed(2)}, FDV: $${fdv.toFixed(2)}`)
  } else {
    // No price data available - use existing current_price for calculations
    const existing_price = token.current_price || 0
    const market_cap = circulating_supply_tokens * existing_price
    const fdv = total_supply_tokens * existing_price
    
    // Update tokens table without changing current_price
    await pool.query(`
      UPDATE public.tokens 
      SET 
        market_cap = $1,
        fdv = $2,
        total_supply = $3,
        volume_24h_eth = $4,
        volume_24h_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = $5 AND chain_id = $6
    `, [
      market_cap, fdv, total_supply, volume_24h_eth,
      token.id, chainId
    ])
    
    console.log(`⚠️ Token ${token.id}: No price data available - kept existing price: ${existing_price}, Market Cap: $${market_cap.toFixed(2)}, FDV: $${fdv.toFixed(2)}`)
  }
}

/**
 * Process a single token
 */
async function processToken(token: TokenRow, chainId: number): Promise<void> {
  console.log(`\n🪙 Processing token ${token.id} (${token.contract_address})...`)
  
  try {
    // Process token balances (processes ALL transfers from the beginning)
    await processTokenBalances(token, chainId)
    
    // Process chart aggregations (1m, 1d, 1w, 1M intervals with dual currency OHLC)
    await processTokenChartAgg(token, chainId)
    
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
    SELECT id, chain_id, contract_address, deployment_block, last_processed_block, is_graduated, creator_wallet, current_price
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
export async function main(): Promise<boolean> {
  console.log('🚀 Starting Aggregation Worker...')
  console.log('📋 Version: [500] - Chart aggregations with dual currency OHLC')
  
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
