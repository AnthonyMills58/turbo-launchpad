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
  
  // Process each transfer to update balances
  for (const transfer of transfers) {
    try {
      // Skip zero transfers
      if (transfer.amount_wei === '0') continue
      
      // Update from address balance (subtract)
      if (transfer.from_address !== '0x0000000000000000000000000000000000000000') {
        await pool.query(`
          INSERT INTO public.token_balances (token_id, chain_id, holder, balance_wei)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (token_id, holder) DO UPDATE SET
            balance_wei = token_balances.balance_wei - EXCLUDED.balance_wei
        `, [token.id, chainId, transfer.from_address.toLowerCase(), transfer.amount_wei])
      }
      
      // Update to address balance (add)
      if (transfer.to_address !== '0x0000000000000000000000000000000000000000') {
        await pool.query(`
          INSERT INTO public.token_balances (token_id, chain_id, holder, balance_wei)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (token_id, holder) DO UPDATE SET
            balance_wei = token_balances.balance_wei + EXCLUDED.balance_wei
        `, [token.id, chainId, transfer.to_address.toLowerCase(), transfer.amount_wei])
      }
      
    } catch (error) {
      console.error(`Token ${token.id}: Error processing transfer:`, error)
    }
  }
  
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
 * Process a single token
 */
async function processToken(token: TokenRow, chainId: number): Promise<void> {
  console.log(`\n🪙 Processing token ${token.id} (${token.contract_address})...`)
  
  try {
    // Process token balances (processes ALL transfers from the beginning)
    await processTokenBalances(token, chainId)
    
    console.log(`✅ Token ${token.id}: Completed processing`)
    
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
