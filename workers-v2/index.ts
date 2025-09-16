#!/usr/bin/env node

/**
 * Turbo Launchpad Worker V2
 * 
 * New implementation with:
 * - Per-token processing loop
 * - Proper rate limiting
 * - Clean graduation logic
 * - Better error handling
 * - UPSERT approach for Railway compatibility
 */

import 'dotenv/config'
import { ethers } from 'ethers'
import type { PoolClient } from 'pg'
import pool from '../lib/db'
import { providerFor } from '../lib/providers'
import { withRateLimit } from './core/rateLimiting'
import { getCurrentEthPrice } from './core/priceCache'
import { getChunkSize, getDexChunkSize, SKIP_HEALTH_CHECK, HEALTH_CHECK_TIMEOUT, MAX_RETRY_ATTEMPTS, LOCK_NS, LOCK_ID, TOKEN_ID, TOKEN_ID_FROM, TOKEN_ID_TO, CHAIN_ID_FILTER, GRADUATED_ONLY, UNGRADUATED_ONLY, HAS_TEST_FILTERS } from './core/config'

// Event topics
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
const SYNC_TOPIC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1'
const GRADUATED_TOPIC = '0x1c858049e704460ab9455025be4078f9e746e3fd426a56040d06389edb8197db'

// Types
interface TokenRow {
  id: number
  chain_id: number
  contract_address: string
  deployment_block: number
  last_processed_block: number
  is_graduated: boolean
  creator_wallet: string | null
}

interface DexPoolRow {
  token_id: number
  chain_id: number
  pair_address: string
  deployment_block: number
  last_processed_block: number
  last_processed_sync_block: number | null
  token0: string
  token1: string
  quote_token: string
  token_decimals: number | null
  weth_decimals: number | null
  quote_decimals: number | null
}

// ---- Singleton advisory lock helpers ----
async function acquireGlobalLock(): Promise<null | { release: () => Promise<void> }> {
  const lockClient: PoolClient = await pool.connect()
  try {
    const { rows } = await lockClient.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [LOCK_NS, LOCK_ID]
    )
    if (!rows[0]?.locked) {
      lockClient.release()
      return null
    }
    return {
      release: async () => {
        await lockClient.query('SELECT pg_advisory_unlock($1, $2)', [LOCK_NS, LOCK_ID])
        lockClient.release()
      }
    }
  } catch (e) {
    lockClient.release()
    throw e
  }
}

/**
 * Check if a chain is healthy
 */
async function checkChainHealth(chainId: number, provider: ethers.JsonRpcProvider): Promise<boolean> {
  try {
    console.log(`Checking health for chain ${chainId}...`)
    
    // Try to get the latest block number with a timeout
    const latestBlock = await Promise.race([
      withRateLimit(() => provider.getBlockNumber(), 2, chainId),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Health check timeout')), HEALTH_CHECK_TIMEOUT)
      )
    ])
    
    // Try to get block details to ensure the chain is actually responding
    const block = await Promise.race([
      withRateLimit(() => provider.getBlock(latestBlock), 2, chainId),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Block fetch timeout')), HEALTH_CHECK_TIMEOUT / 2)
      )
    ])
    
    if (!block) {
      console.warn(`Chain ${chainId}: Health check failed - no block data`)
      return false
    }
    
    console.log(`Chain ${chainId}: Health check passed - latest block ${latestBlock}`)
    return true
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.warn(`Chain ${chainId}: Health check failed - ${errorMsg}`)
    return false
  }
}


/**
 * Main worker function
 */
// Global ETH price for this worker run
let currentEthPriceUsd: number | null = null

/**
 * Get current ETH price for transfer recording
 */
function getEthPriceForTransfer(): number | null {
  return currentEthPriceUsd
}

async function main(): Promise<boolean> {
  console.log('🚀 Starting Turbo Launchpad Worker V2...')
  console.log('📋 Version: [400] - Adding USD price support to transfers')
  
  // Get current ETH price once at the beginning of worker run
  currentEthPriceUsd = await getCurrentEthPrice()
  if (currentEthPriceUsd) {
    console.log(`💰 Current ETH price: $${currentEthPriceUsd.toFixed(2)}`)
  } else {
    console.warn('⚠️ Could not fetch ETH price - USD calculations will be skipped')
  }
  
  // Acquire global lock to prevent overlapping runs
  const lock = await acquireGlobalLock()
  if (!lock) {
    console.log('Another worker run is in progress. Exiting.')
    return false // Indicate that worker should exit
  }
  
  try {
    // Get all chains
    console.log('📊 Querying database for chains...')
    const { rows: chains } = await pool.query('SELECT DISTINCT chain_id FROM public.tokens ORDER BY chain_id')
    console.log(`📊 Found ${chains.length} chains:`, chains.map(c => c.chain_id))
    
    // Health check before processing
    if (!SKIP_HEALTH_CHECK) {
      console.log(`\n🔍 Checking chain health before processing...`)
      const healthyChains: number[] = []
      
      for (const { chain_id } of chains) {
        const provider = providerFor(chain_id)
        const isHealthy = await checkChainHealth(chain_id, provider)
        
        if (isHealthy) {
          healthyChains.push(chain_id)
          console.log(`✅ Chain ${chain_id}: Healthy - will process`)
        } else {
          console.log(`❌ Chain ${chain_id}: Unhealthy - skipping`)
        }
      }
      
      if (healthyChains.length === 0) {
        console.log('❌ No healthy chains found. Exiting.')
        return false
      } else {
        console.log(`\n✅ Processing ${healthyChains.length} healthy chains (of ${chains.length})`)
        
        // Process only healthy chains
        for (const chain_id of healthyChains) {
          console.log(`\n📊 Processing chain ${chain_id}...`)
          await processChain(chain_id)
        }
      }
    } else {
      console.log(`\n⚠️  Health checks disabled - processing all ${chains.length} chains`)
      
      // Process all chains
      for (const { chain_id } of chains) {
        console.log(`\n📊 Processing chain ${chain_id}...`)
        await processChain(chain_id)
      }
    }
    
    // Run aggregations after all data processing is complete
    console.log('\n📊 Running aggregations...')
    try {
      const { spawn } = await import('child_process')
      const aggProcess = spawn('npx', ['ts-node', 'workers-v2/agg.ts'], {
        stdio: 'inherit',
        cwd: process.cwd()
      })
      
      await new Promise<void>((resolve, reject) => {
        aggProcess.on('close', (code: number | null) => {
          if (code === 0) {
            console.log('✅ Aggregations completed successfully!')
            resolve()
          } else {
            console.error(`❌ Aggregations failed with code ${code}`)
            reject(new Error(`Aggregations failed with code ${code}`))
          }
        })
      })
    } catch (aggError) {
      console.error('❌ Failed to run aggregations:', aggError)
      // Don't fail the entire worker if aggregations fail
    }
    
    console.log('\n✅ Worker V2 cycle completed successfully!')
    return true // Indicate successful completion
  } catch (error) {
    console.error('❌ Worker V2 failed:', error)
    process.exit(1)
  } finally {
    // Release the global lock
    await lock.release()
  }
}


/**
 * Process all tokens for a specific chain
 */
async function processChain(chainId: number) {
  console.log(`🔗 Setting up provider for chain ${chainId}...`)
  const provider = providerFor(chainId)
  
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
      await processToken(token, provider, chainId)
    } catch (error) {
      // Any error that reaches here means all retry attempts were exhausted
      console.error(`🔄 Token ${token.id}: All retry attempts exhausted - skipping to next token:`, error)
      // Continue with next token instead of failing entire chain
    }
  }
}

/**
 * Process a single token
 */
async function processToken(token: TokenRow, provider: ethers.JsonRpcProvider, chainId: number) {
  console.log(`🔍 Getting current block for token ${token.id}...`)
  const currentBlock = await withRateLimit(() => provider.getBlockNumber(), 2, chainId)
  console.log(`🔍 Current block: ${currentBlock}`)
  
  // Determine processing range
  const startBlock = token.last_processed_block + 1
  const endBlock = currentBlock
  
  if (startBlock > endBlock) {
    console.log(`Token ${token.id}: Already up to date (${startBlock} > ${endBlock})`)
    return
  }
  
  console.log(`Token ${token.id}: Processing blocks ${startBlock} to ${endBlock}`)
  
  // Get DEX pool info if graduated
  let dexPool: DexPoolRow | null = null
  console.log(`Token ${token.id}: is_graduated = ${token.is_graduated}`)
  
  if (token.is_graduated) {
    const { rows } = await pool.query<DexPoolRow>(`
      SELECT token_id, chain_id, pair_address, deployment_block, last_processed_block, last_processed_sync_block, token0, token1, quote_token, token_decimals, weth_decimals, quote_decimals
      FROM public.dex_pools 
      WHERE token_id = $1 AND chain_id = $2
    `, [token.id, chainId])
    
    console.log(`Token ${token.id}: Found ${rows.length} DEX pool records`)
    console.log(`Token ${token.id}: Query was: SELECT * FROM dex_pools WHERE token_id = ${token.id} AND chain_id = ${chainId}`)
    if (rows.length > 0) {
      dexPool = rows[0]
      console.log(`Token ${token.id}: Found DEX pool ${dexPool.pair_address}`)
      console.log(`Token ${token.id}: Full DEX pool record:`, dexPool)
    } else {
      console.log(`Token ${token.id}: No DEX pool record found despite being graduated`)
      console.log(`Token ${token.id}: Token details - ID: ${token.id}, Chain: ${chainId}, Contract: ${token.contract_address}`)
    }
  } else {
    console.log(`Token ${token.id}: Not graduated - skipping DEX processing`)
  }
  
  // Process in chunks: transfers first, then DEX for each chunk
  const bcChunkSize = getChunkSize(chainId)        // BC transfers: larger chunks
  const dexChunkSize = getDexChunkSize(chainId)    // DEX events: smaller chunks
  let lastSuccessfulBlock = startBlock - 1 // Track last successfully processed block
  let hasFinalRetryFailure = false // Track if we had a final retry failure
  let hasDexFinalRetryFailure = false // Track if we had a final retry failure in DEX processing
  
  // Continue processing until all processes are up to date
  while (true) {
    let anyProcessNeedsWork = false
    
    // Check if BC transfers need work
    const bcNeedsWork = lastSuccessfulBlock < endBlock
    if (bcNeedsWork) {
      anyProcessNeedsWork = true
      const bcFrom = lastSuccessfulBlock + 1
      const bcTo = Math.min(bcFrom + bcChunkSize, endBlock)
      
      // Get timestamp for the last block in range for better debugging
      const toBlockInfo = await withRateLimit(() => provider.getBlock(bcTo), 2, chainId)
      const toBlockTimestamp = toBlockInfo ? new Date(Number(toBlockInfo.timestamp) * 1000).toISOString() : 'unknown'
      console.log(`Token ${token.id}: Processing BC chunk ${bcFrom} to ${bcTo} (last block timestamp: ${toBlockTimestamp})`)
      
      try {
        await processTransferChunk(token, dexPool, provider, chainId, bcFrom, bcTo)
        lastSuccessfulBlock = bcTo
        console.log(`✅ Token ${token.id}: Processed BC chunk ${bcFrom} to ${bcTo}`)
        
        // Update last_processed_block in database after each successful BC chunk
        console.log(`🔄 Token ${token.id}: Updating database last_processed_block to ${bcTo}`)
        try {
          const updateResult = await pool.query(`
            INSERT INTO public.tokens (id, last_processed_block, name, symbol, supply, raise_target, dex, creator_wallet, chain_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET 
              last_processed_block = EXCLUDED.last_processed_block,
              updated_at = now()
          `, [token.id, bcTo, `Token ${token.id}`, `TKN${token.id}`, 1000000, 100, 'uniswap', token.creator_wallet || '', token.chain_id])
          
          console.log(`✅ Token ${token.id}: Successfully processed BC chunk ${bcFrom} to ${bcTo} and updated DB to block ${bcTo} (rows affected: ${updateResult.rowCount})`)
        } catch (updateError) {
          console.error(`❌ Token ${token.id}: Failed to update last_processed_block:`, updateError)
          throw updateError
        }
      } catch (error) {
        console.error(`❌ Token ${token.id}: Error processing BC chunk ${bcFrom} to ${bcTo}:`, error)
        hasFinalRetryFailure = true
        // Don't throw - continue with other operations (SWAP, SYNC)
      }
    }
    
    // Check if SWAP events need work (if graduated)
      if (dexPool) {
      // Refresh dexPool data to get latest cursor values
      const { rows: freshDexPools } = await pool.query<DexPoolRow>(`
        SELECT token_id, chain_id, pair_address, deployment_block, last_processed_block, last_processed_sync_block, token0, token1, quote_token, token_decimals, weth_decimals, quote_decimals
        FROM public.dex_pools 
        WHERE token_id = $1 AND chain_id = $2
      `, [token.id, chainId])
      
      if (freshDexPools.length > 0) {
        const freshDexPool = freshDexPools[0]
        const swapLastProcessed = freshDexPool.last_processed_block || 0
        const swapNeedsWork = swapLastProcessed < endBlock
        if (swapNeedsWork) {
          anyProcessNeedsWork = true
          const swapFrom = swapLastProcessed + 1
          const swapTo = Math.min(swapFrom + dexChunkSize, endBlock)
          
          console.log(`Token ${token.id}: Processing SWAP chunk ${swapFrom} to ${swapTo}`)
          try {
            await processSwapChunk(token, freshDexPool, provider, chainId, swapFrom, swapTo)
            console.log(`✅ Token ${token.id}: Processed SWAP chunk ${swapFrom} to ${swapTo}`)
          } catch (error) {
            console.error(`❌ Token ${token.id}: Error processing SWAP chunk ${swapFrom} to ${swapTo}:`, error)
            hasDexFinalRetryFailure = true
            // Don't throw - continue with other operations (SYNC)
          }
        }
      }
    }
    
    // Check if SYNC events need work (if graduated)
    if (dexPool) {
      // Refresh dexPool data to get latest cursor values
      const { rows: freshDexPools } = await pool.query<DexPoolRow>(`
        SELECT token_id, chain_id, pair_address, deployment_block, last_processed_block, last_processed_sync_block, token0, token1, quote_token, token_decimals, weth_decimals, quote_decimals
        FROM public.dex_pools 
        WHERE token_id = $1 AND chain_id = $2
      `, [token.id, chainId])
      
      if (freshDexPools.length > 0) {
        const freshDexPool = freshDexPools[0]
        const syncLastProcessed = Number(freshDexPool.last_processed_sync_block) || 0
        const syncNeedsWork = syncLastProcessed < endBlock
        if (syncNeedsWork) {
          anyProcessNeedsWork = true
          const syncFrom = syncLastProcessed + 1
          const syncTo = Math.min(syncFrom + dexChunkSize, endBlock)
          
          console.log(`Token ${token.id}: Processing SYNC chunk ${syncFrom} to ${syncTo}`)
          try {
            await processSyncChunk(token, freshDexPool, provider, chainId, syncFrom, syncTo)
            console.log(`✅ Token ${token.id}: Processed SYNC chunk ${syncFrom} to ${syncTo}`)
    } catch (error) {
            console.error(`❌ Token ${token.id}: Error processing SYNC chunk ${syncFrom} to ${syncTo}:`, error)
            hasDexFinalRetryFailure = true
            // Don't throw - continue with next token
          }
        }
      }
    }
    
    // If no process needs work, we're done
    if (!anyProcessNeedsWork) {
      console.log(`Token ${token.id}: All processes up to date`)
      break
    }
  }
  
  // Log final status
  if (hasFinalRetryFailure || hasDexFinalRetryFailure) {
    console.log(`🔄 Token ${token.id}: Final retry failure occurred (transfer: ${hasFinalRetryFailure}, DEX: ${hasDexFinalRetryFailure}) - processing stopped`)
  } else if (lastSuccessfulBlock >= startBlock) {
    console.log(`✅ Token ${token.id}: Completed processing up to block ${lastSuccessfulBlock}`)
  } else {
    console.log(`❌ Token ${token.id}: No blocks processed successfully`)
  }
}

/**
 * Process transfer logs for a chunk of blocks
 */
async function processTransferChunk(
  token: TokenRow,
  dexPool: DexPoolRow | null,
  provider: ethers.JsonRpcProvider,
  chainId: number,
  fromBlock: number,
  toBlock: number
) {
  // Get transfer logs for token
  const transferLogs = await withRateLimit(() => provider.getLogs({
    address: token.contract_address,
    topics: [TRANSFER_TOPIC],
    fromBlock,
    toBlock
  }), MAX_RETRY_ATTEMPTS, chainId)
  
  console.log(`Token ${token.id}: Found ${transferLogs.length} transfer logs`)
  
  // Check if this block range contains graduation transactions
  // For graduation detection, we need to check if this block range contains graduation patterns
  // We'll detect graduation by looking for transactions with multiple transfer logs that match graduation patterns
  const graduationBlock = dexPool?.deployment_block || 0
  let isGraduationBlockRange = fromBlock >= graduationBlock && graduationBlock > 0
  
  // If no DEX pool yet, check if this might be a graduation block range by looking for graduation patterns
  if (!isGraduationBlockRange && transferLogs.length > 0) {
    // Group logs by transaction to check for graduation patterns
    const logsByTx = new Map<string, ethers.Log[]>()
    for (const log of transferLogs) {
      const txHash = log.transactionHash!
      if (!logsByTx.has(txHash)) {
        logsByTx.set(txHash, [])
      }
      logsByTx.get(txHash)!.push(log)
    }
    
    // Check if any transaction has graduation pattern (3+ transfer logs)
    for (const [txHash, logs] of logsByTx) {
      if (logs.length >= 3) {
        // This might be a graduation transaction - treat as graduation block range
        console.log(`Token ${token.id}: Detected potential graduation block range (${logs.length} logs in tx ${txHash})`)
        isGraduationBlockRange = true
        break
      }
    }
  }
  
  console.log(`Token ${token.id}: Block range ${fromBlock}-${toBlock}, graduation block: ${graduationBlock}, is graduation range: ${isGraduationBlockRange}`)
  
  if (isGraduationBlockRange) {
    console.log(`Token ${token.id}: Processing graduation block range ${fromBlock}-${toBlock}`)
    
    // Group logs by transaction for graduation processing
    const logsByTx = new Map<string, ethers.Log[]>()
    for (const log of transferLogs) {
      const txHash = log.transactionHash!
      if (!logsByTx.has(txHash)) {
        logsByTx.set(txHash, [])
      }
      logsByTx.get(txHash)!.push(log)
    }
    
    // Process each graduation transaction
    for (const [txHash, logs] of logsByTx) {
      const tx = await withRateLimit(() => provider.getTransaction(txHash), MAX_RETRY_ATTEMPTS, chainId)
      if (!tx) {
        console.log(`Token ${token.id}: No transaction found for ${txHash}`)
        continue
      }
      
      // Check if this is a graduation transaction
      const firstLog = logs[0]
      console.log(`Token ${token.id}: Checking graduation for tx ${tx.hash} with ${logs.length} logs`)
      const isGraduation = await detectGraduation(token, firstLog, tx, provider, chainId)
      console.log(`Token ${token.id}: Graduation detected: ${isGraduation}`)
      
      if (isGraduation) {
        // Process graduation (creates 2 records: BUY + GRADUATION)
        console.log(`Token ${token.id}: Processing graduation transaction ${tx.hash}`)
        const block = await withRateLimit(() => provider.getBlock(firstLog.blockNumber), MAX_RETRY_ATTEMPTS, chainId)
        const blockTime = new Date(Number(block!.timestamp) * 1000)
        await createGraduationRecords(token, firstLog, tx, blockTime, provider, chainId, dexPool)
        // Skip processing individual logs - graduation handles all logs in this transaction
      } else {
        // Process each regular transfer log
        console.log(`Token ${token.id}: Processing ${logs.length} regular transfer logs`)
        for (const log of logs) {
          await processTransferLog(token, dexPool, log, provider, chainId)
        }
      }
    }
  } else {
    // Regular block range - process each log individually
    for (const log of transferLogs) {
      await processTransferLog(token, dexPool, log, provider, chainId)
    }
  }
  
  // DEX processing is now handled separately in the main loop
}



/**
 * Process DEX logs for a specific token's DEX pool
 * Now handles separate cursors for SWAP and SYNC events
 */
async function processSwapChunk(
  token: TokenRow,
  dexPool: DexPoolRow,
  provider: ethers.JsonRpcProvider,
  chainId: number,
  fromBlock: number,
  toBlock: number
) {
  const pairAddress = ethers.getAddress(dexPool.pair_address)
  console.log(`Token ${token.id}: Processing SWAP events for blocks ${fromBlock} to ${toBlock}`)
  
  const swapLogs = await withRateLimit(() => provider.getLogs({
    address: pairAddress,
    topics: [SWAP_TOPIC],
    fromBlock: fromBlock,
    toBlock: toBlock
  }), MAX_RETRY_ATTEMPTS, chainId)
  
  console.log(`Token ${token.id}: Found ${swapLogs.length} DEX swaps`)
  
  for (const log of swapLogs) {
    await processDexLog(token, dexPool, log, provider, chainId)
  }
  
  console.log(`✅ Token ${token.id}: Processed SWAP events for blocks ${fromBlock} to ${toBlock}`)
  
  // Update SWAP cursor
  await pool.query(`
    INSERT INTO public.dex_pools (token_id, chain_id, pair_address, last_processed_block, last_processed_sync_block, token0, token1, quote_token, token_decimals, weth_decimals, quote_decimals, deployment_block)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (chain_id, pair_address) DO UPDATE SET 
      last_processed_block = EXCLUDED.last_processed_block
  `, [token.id, chainId, dexPool.pair_address, toBlock, dexPool.last_processed_sync_block, dexPool.token0, dexPool.token1, dexPool.quote_token, dexPool.token_decimals, dexPool.weth_decimals, dexPool.quote_decimals, dexPool.deployment_block])
  
  console.log(`✅ Token ${token.id}: Updated SWAP cursor to block ${toBlock}`)
}

async function processSyncChunk(
  token: TokenRow,
  dexPool: DexPoolRow,
  provider: ethers.JsonRpcProvider,
  chainId: number,
  fromBlock: number,
  toBlock: number
) {
  const pairAddress = ethers.getAddress(dexPool.pair_address)
  console.log(`Token ${token.id}: Processing SYNC events for blocks ${fromBlock} to ${toBlock}`)
  
  const syncLogs = await withRateLimit(() => provider.getLogs({
    address: pairAddress,
    topics: [SYNC_TOPIC],
    fromBlock: fromBlock,
    toBlock: toBlock
  }), MAX_RETRY_ATTEMPTS, chainId)
  
  console.log(`Token ${token.id}: Found ${syncLogs.length} DEX sync events`)
  
  for (const log of syncLogs) {
    await processSyncLog(token, dexPool, log, provider, chainId)
  }
  
  console.log(`✅ Token ${token.id}: Processed SYNC events for blocks ${fromBlock} to ${toBlock}`)
  
  // Update SYNC cursor
  await pool.query(`
    INSERT INTO public.dex_pools (token_id, chain_id, pair_address, last_processed_block, last_processed_sync_block, token0, token1, quote_token, token_decimals, weth_decimals, quote_decimals, deployment_block)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (chain_id, pair_address) DO UPDATE SET 
      last_processed_sync_block = EXCLUDED.last_processed_sync_block
  `, [token.id, chainId, dexPool.pair_address, dexPool.last_processed_block, toBlock, dexPool.token0, dexPool.token1, dexPool.quote_token, dexPool.token_decimals, dexPool.weth_decimals, dexPool.quote_decimals, dexPool.deployment_block])
  
  console.log(`✅ Token ${token.id}: Updated SYNC cursor to block ${toBlock}`)
}

/**
 * Process a transfer log
 */
async function processTransferLog(
  token: TokenRow,
  dexPool: DexPoolRow | null,
  log: ethers.Log,
  provider: ethers.JsonRpcProvider,
  chainId: number
) {
  try {
    // Parse transfer log
    const fromAddress = ethers.getAddress('0x' + log.topics[1].slice(26))
    const toAddress = ethers.getAddress('0x' + log.topics[2].slice(26))
    const amount = BigInt(log.data)
    
  // Get transaction details with more conservative retry
  let tx: ethers.TransactionResponse | null = null
  try {
    tx = await withRateLimit(() => provider.getTransaction(log.transactionHash!), MAX_RETRY_ATTEMPTS, chainId)
  } catch (error) {
    console.warn(`Token ${token.id}: Failed to get transaction ${log.transactionHash}, skipping: ${error}`)
    return
  }
  
  if (!tx) {
    console.log(`Token ${token.id}: No transaction found for ${log.transactionHash}`)
    return
  }
    
    // Get block timestamp
    const block = await withRateLimit(() => provider.getBlock(log.blockNumber), MAX_RETRY_ATTEMPTS, chainId)
    const blockTime = new Date(Number(block!.timestamp) * 1000)
    
    // Process regular transfer (graduation is handled in main loop)
        await processRegularTransfer(token, dexPool, log, tx, fromAddress, toAddress, amount, blockTime, chainId, provider)
  } catch (error) {
    console.error(`❌ Failed to process transfer log ${log.transactionHash}:`, error)
    throw error // Re-throw to stop processing and prevent cursor advancement
  }
}

/**
 * Detect if a transfer is part of graduation
 */
async function detectGraduation(
  token: TokenRow,
  log: ethers.Log,
  tx: ethers.TransactionResponse,
  provider: ethers.JsonRpcProvider,
  chainId: number
): Promise<boolean> {
  // Check if this transaction contains graduation by looking for Graduated event
  try {
    const receipt = await withRateLimit(() => provider.getTransactionReceipt(tx.hash), MAX_RETRY_ATTEMPTS, chainId)
    if (receipt) {
      // Check for Graduated event
      const graduatedEvent = receipt.logs.find(log => 
        log.topics[0] === GRADUATED_TOPIC
      )
      
      if (graduatedEvent) {
        console.log(`Token ${token.id}: Found Graduated event in tx ${tx.hash}`)
        return true
      }
      
      // Fallback: Check if this is a graduation transaction by looking for multiple transfer logs
      // Graduation typically has: mint to user + mint to contract + transfer to LP
      const transferLogs = receipt.logs.filter(log => 
        log.topics[0] === TRANSFER_TOPIC && 
        log.address.toLowerCase() === token.contract_address.toLowerCase()
      )
      
      if (transferLogs.length >= 3) {
        // Check for graduation pattern: mint to user + mint to contract + transfer from contract
        const mintToUser = transferLogs.find(log => {
          const fromAddr = ethers.getAddress('0x' + log.topics[1].slice(26))
          const toAddr = ethers.getAddress('0x' + log.topics[2].slice(26))
          return fromAddr === '0x0000000000000000000000000000000000000000' && 
                 toAddr !== token.contract_address
        })
        
        const mintToContract = transferLogs.find(log => {
          const fromAddr = ethers.getAddress('0x' + log.topics[1].slice(26))
          const toAddr = ethers.getAddress('0x' + log.topics[2].slice(26))
          return fromAddr === '0x0000000000000000000000000000000000000000' && 
                 toAddr.toLowerCase() === token.contract_address.toLowerCase()
        })
        
        const transferFromContract = transferLogs.find(log => {
          const fromAddr = ethers.getAddress('0x' + log.topics[1].slice(26))
          return fromAddr.toLowerCase() === token.contract_address.toLowerCase()
        })
        
        if (mintToUser && mintToContract && transferFromContract) {
          console.log(`Token ${token.id}: Detected graduation pattern in tx ${tx.hash} (${transferLogs.length} transfer logs)`)
          return true
        }
      }
    }
  } catch (error) {
    console.warn(`Could not get receipt for graduation check: ${error}`)
  }
  
  return false
}

/**
 * Create 2 graduation records: User BUY + Graduation Summary
 */
async function createGraduationRecords(
  token: TokenRow,
  log: ethers.Log,
  tx: ethers.TransactionResponse,
  blockTime: Date,
  provider: ethers.JsonRpcProvider,
  chainId: number,
  dexPool: DexPoolRow | null
) {
  // Get all transfer logs for this transaction to find the correct amounts
  const allLogs = await withRateLimit(() => provider.getLogs({
    address: token.contract_address,
    topics: [TRANSFER_TOPIC],
    fromBlock: log.blockNumber,
    toBlock: log.blockNumber
  }), 2, chainId)
  
  // Filter logs for this specific transaction
  const txLogs = allLogs.filter(l => l.transactionHash === log.transactionHash)
  
  // Find the user BUY transfer (mint to user address)
  const userBuyLog = txLogs.find(l => {
    const fromAddr = ethers.getAddress('0x' + l.topics[1].slice(26))
    const toAddr = ethers.getAddress('0x' + l.topics[2].slice(26))
    return fromAddr === '0x0000000000000000000000000000000000000000' && 
           toAddr !== token.contract_address
  })
  
  // Find the graduation transfer (mint to contract)
  const graduationLog = txLogs.find(l => {
    const fromAddr = ethers.getAddress('0x' + l.topics[1].slice(26))
    const toAddr = ethers.getAddress('0x' + l.topics[2].slice(26))
    return fromAddr === '0x0000000000000000000000000000000000000000' && 
           toAddr.toLowerCase() === token.contract_address.toLowerCase()
  })
  
  // Find the LP transfer (contract to LP pool)
  const lpTransferLog = txLogs.find(l => {
    const fromAddr = ethers.getAddress('0x' + l.topics[1].slice(26))
    const toAddr = ethers.getAddress('0x' + l.topics[2].slice(26))
    return fromAddr.toLowerCase() === token.contract_address.toLowerCase() && 
           toAddr !== '0x0000000000000000000000000000000000000000'
  })
  
  if (!userBuyLog || !graduationLog) {
    console.error(`Token ${token.id}: Could not find user BUY or graduation logs in transaction ${log.transactionHash}`)
    return
  }
  
  const userAmount = BigInt(userBuyLog.data)
  const graduationAmount = BigInt(graduationLog.data)
  const userToAddress = ethers.getAddress('0x' + userBuyLog.topics[2].slice(26))
  const lpToAddress = lpTransferLog ? ethers.getAddress('0x' + lpTransferLog.topics[2].slice(26)) : '0x0000000000000000000000000000000000000000'
  
  // Get transaction value (ETH paid by user)
  const userEthAmount = tx.value || 0n
  
  // LOG: Show original BUY record details before consolidation
  console.log(`\n=== ORIGINAL BUY RECORD (before graduation consolidation) ===`)
  console.log(`Token ${token.id}: User BUY log found:`)
  console.log(`  - From: 0x0000... (zero address - mint)`)
  console.log(`  - To: ${userToAddress}`)
  console.log(`  - Amount Wei: ${userAmount.toString()}`)
  console.log(`  - Transaction Value (ETH): ${userEthAmount.toString()}`)
  console.log(`  - Transaction Hash: ${userBuyLog.transactionHash}`)
  console.log(`  - Block Number: ${userBuyLog.blockNumber}`)
  console.log(`=== END ORIGINAL BUY RECORD ===\n`)
  
  // Find the add liquidity event to get the actual amounts added to the pool
  let liquidityTokenAmount = 0n
  let liquidityEthAmount = 0n
  try {
    const receipt = await withRateLimit(() => provider.getTransactionReceipt(tx.hash), MAX_RETRY_ATTEMPTS, chainId)
    if (receipt) {
      // Look for addLiquidity event in the transaction receipt
      // The addLiquidity event should be from the DEX pair contract
      const addLiquidityInterface = new ethers.Interface([
        'event Mint(address indexed sender, uint amount0, uint amount1)'
      ])
      
      // Find the Mint event (which is the addLiquidity event)
      const mintEvent = receipt.logs.find(log => {
        try {
          const decoded = addLiquidityInterface.parseLog({
            topics: log.topics,
            data: log.data
          })
          return decoded && decoded.name === 'Mint'
        } catch {
          return false
        }
      })
      
      if (mintEvent) {
        const decoded = addLiquidityInterface.parseLog({
          topics: mintEvent.topics,
          data: mintEvent.data
        })
        
        if (decoded) {
          const { amount0, amount1 } = decoded.args
          
          // Get actual token addresses from the DEX pair contract to determine correct mapping
          if (dexPool) {
            // Query the actual DEX pair contract to get real token order
            const pair = new ethers.Contract(dexPool.pair_address, [
              'function token0() view returns (address)',
              'function token1() view returns (address)'
            ], provider)
            
            const actualToken0 = await withRateLimit(() => pair.token0(), MAX_RETRY_ATTEMPTS, chainId)
            const actualToken1 = await withRateLimit(() => pair.token1(), MAX_RETRY_ATTEMPTS, chainId)
            
            // Get WETH address from database (quote_token is always WETH)
            const wethAddress = dexPool.quote_token
            
            // Determine which amount corresponds to which token
            const isWethToken0 = actualToken0.toLowerCase() === wethAddress.toLowerCase()
            
            if (isWethToken0) {
              // WETH is token0, our token is token1
              liquidityTokenAmount = amount1  // amount1 = our token
              liquidityEthAmount = amount0    // amount0 = WETH
            } else {
              // Our token is token0, WETH is token1
              liquidityTokenAmount = amount0  // amount0 = our token
              liquidityEthAmount = amount1    // amount1 = WETH
            }
            
            console.log(`Token ${token.id}: Found addLiquidity event - amount0: ${amount0}, amount1: ${amount1}`)
            console.log(`Token ${token.id}: Actual DEX pair - token0: ${actualToken0}, token1: ${actualToken1}`)
            console.log(`Token ${token.id}: WETH address: ${wethAddress}, isWethToken0: ${isWethToken0}`)
            console.log(`Token ${token.id}: Calculated - Token: ${liquidityTokenAmount}, ETH: ${liquidityEthAmount}`)
          } else {
            console.warn(`Token ${token.id}: No DEX pool info available for addLiquidity decoding`)
            liquidityEthAmount = tx.value || 0n
          }
        }
      } else {
        console.warn(`Token ${token.id}: No addLiquidity event found, using transaction value`)
        liquidityEthAmount = tx.value || 0n
      }
    }
  } catch (error) {
    console.warn(`Could not get receipt for liquidity amount: ${error}`)
    liquidityEthAmount = tx.value || 0n
  }
  
  // Calculate price for user BUY record
  const userPriceEthPerToken = userEthAmount > 0n && userAmount > 0n ? Number(userEthAmount) / Number(userAmount) : 0
  
  // Calculate price for GRADUATION record (addLiquidity price)
  const graduationPriceEthPerToken = liquidityEthAmount > 0n && liquidityTokenAmount > 0n ? Number(liquidityEthAmount) / Number(liquidityTokenAmount) : 0
  
  // Record 1: User BUY (the transaction that triggered graduation)
  await pool.query(`
    INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, eth_price_usd)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  `, [
    token.id, chainId, token.contract_address, log.blockNumber, blockTime, log.transactionHash,
    userBuyLog.index, // Use actual log index from the original user buy log
    '0x0000000000000000000000000000000000000000', // From zero address (mint)
    userToAddress, // To user who triggered graduation
    userAmount.toString(),
    userEthAmount.toString(), // Use transaction value (ETH paid by user)
    userPriceEthPerToken, // Use calculated price for user transaction
    'BUY',
    'BC', // Bonding curve operation
    getEthPriceForTransfer()
  ])
  
  // Record 2: Graduation Summary (contract to LP pool with addLiquidity amounts)
  await pool.query(`
    INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, graduation_metadata, eth_price_usd)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
  `, [
    token.id, chainId, token.contract_address, log.blockNumber, blockTime, log.transactionHash,
    graduationLog.index, // Use actual log index from the original graduation log
    token.contract_address, // From contract
    lpToAddress, // To LP pool (or zero address if not found)
    liquidityTokenAmount.toString(), // amount_wei (token amount)
    liquidityEthAmount.toString(),   // amount_eth_wei (ETH amount)
    graduationPriceEthPerToken, // Use addLiquidity price (amount_eth_wei / amount_wei)
    'GRADUATION',
    'BC', // Bonding curve operation
    JSON.stringify({
      type: 'graduation',
      phase: 'summary',
      addliquidity_tokens: liquidityTokenAmount.toString(),
      addliquidity_eth: liquidityEthAmount.toString(),
      addliquidity_price_eth_per_token: graduationPriceEthPerToken,
      graduation_trigger: tx.from,
      user_tokens: userAmount.toString(),
      user_eth: userEthAmount.toString(),
      graduation_tokens: graduationAmount.toString(),
      lp_address: lpToAddress !== '0x0000000000000000000000000000000000000000' ? lpToAddress : null,
      reserves: null // Will be populated when DEX pool is processed
    }),
    getEthPriceForTransfer()
  ])
  
  console.log(`✅ Token ${token.id}: Created 2 graduation records (BUY + GRADUATION)`)
}

/**
 * Determine transfer type (BUY, BUY&LOCK, SELL, etc.)
 */
function determineTransferType(
  token: TokenRow,
  tx: ethers.TransactionResponse,
  fromAddress: string,
  toAddress: string
): string {
  // Check function selector first
  if (tx.data && tx.data.length >= 10) {
    const functionSelectors: Record<string, string> = {
      '0xb34ffc5f': 'BUY&LOCK',      // creatorBuy(uint256)
      '0x5b88349d': 'CLAIMAIRDROP',  // claimAirdrop()
      '0xb4105e06': 'UNLOCK',        // unlockCreatorTokens()
    }
    
    const selector = tx.data.slice(0, 10)
    const functionName = functionSelectors[selector]
    if (functionName) {
      return functionName
    }
  }
  
  // Check address patterns
  if (fromAddress === '0x0000000000000000000000000000000000000000') {
    // Mint from zero address
    if (tx.value && tx.value > 0n) {
      // Check if transaction is from the creator wallet
      if (token.creator_wallet && tx.from && tx.from.toLowerCase() === token.creator_wallet.toLowerCase()) {
        return 'BUY&LOCK' // Creator buy operation
      }
      return 'BUY' // Regular buy (mint to user with ETH)
    }
    // Check for graduation (mint to contract without ETH)
    if (toAddress.toLowerCase() === token.contract_address.toLowerCase()) {
      return 'GRADUATION' // Graduation mint to contract
    }
    return 'TRANSFER' // Regular token creation (mint without ETH)
  }
  
  // Check for burn to zero address (SELL operation)
  if (toAddress === '0x0000000000000000000000000000000000000000') {
    return 'SELL' // Burn to zero address (user selling tokens)
  }
  
  // Regular transfer
  return 'TRANSFER'
}

/**
 * Process regular transfer (non-graduation)
 */
async function processRegularTransfer(
  token: TokenRow,
  dexPool: DexPoolRow | null,
  log: ethers.Log,
  tx: ethers.TransactionResponse,
  fromAddress: string,
  toAddress: string,
  amount: bigint,
  blockTime: Date,
  chainId: number,
  provider: ethers.JsonRpcProvider
) {
  // Determine transfer type
  const transferType = determineTransferType(token, tx, fromAddress, toAddress)
  
  // Skip generic TRANSFER transactions - we only want specific operations
  if (transferType === 'TRANSFER') {
    console.log(`Token ${token.id}: Skipping generic TRANSFER transaction at block ${log.blockNumber}`)
    return
  }
  
  const side = transferType
  const src = 'BC' // All transfers from BC contract are BC operations
  let ethAmount = 0n
  let priceEthPerToken = null
  
  console.log(`Token ${token.id}: Processing ${transferType} transfer at block ${log.blockNumber}`)
  
  // Process the transaction based on its type
    if (transferType === 'BUY' || transferType === 'BUY&LOCK') {
      ethAmount = tx.value || 0n
      if (ethAmount > 0n && amount > 0n) {
        priceEthPerToken = Number(ethAmount) / Number(amount)
      }
    } else if (transferType === 'SELL') {
      // For SELL, calculate the ETH amount received by calling getSellPrice
      // Use block before transaction to get the correct price (like old worker)
      try {
        const receipt = await withRateLimit(() => provider.getTransactionReceipt(log.transactionHash!), MAX_RETRY_ATTEMPTS, chainId)
        if (receipt && receipt.blockNumber) {
          const blockBeforeTx = receipt.blockNumber - 1
          
          const turboTokenInterface = new ethers.Interface([
            'function getSellPrice(uint256 tokenAmount) view returns (uint256)'
          ])
          
          const sellPriceWei = await withRateLimit(() => provider.call({
            to: token.contract_address,
            data: turboTokenInterface.encodeFunctionData('getSellPrice', [amount]),
            blockTag: blockBeforeTx
          }), 2, chainId)
          
          if (sellPriceWei && sellPriceWei !== '0x') {
            ethAmount = BigInt(sellPriceWei.toString())
            if (ethAmount > 0n && amount > 0n) {
              priceEthPerToken = Number(ethAmount) / Number(amount)
            }
            console.log(`Token ${token.id}: SELL - ${amount} tokens for ${ethAmount} ETH (price: ${priceEthPerToken}) at block ${blockBeforeTx}`)
          } else {
            console.warn(`Token ${token.id}: SELL price call returned empty result`)
          }
        } else {
          console.warn(`Token ${token.id}: Could not get transaction receipt for SELL`)
        }
      } catch (error) {
        console.warn(`Token ${token.id}: Could not get SELL price: ${error}`)
    }
  }
  
  // Insert transfer record
  try {
  await pool.query(`
    INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, eth_price_usd)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (chain_id, tx_hash, log_index) DO UPDATE SET
      side = EXCLUDED.side,
      src = EXCLUDED.src,
      eth_price_usd = EXCLUDED.eth_price_usd
  `, [
    token.id, chainId, token.contract_address, log.blockNumber, blockTime, log.transactionHash,
    log.index, fromAddress, toAddress, amount.toString(), ethAmount.toString(), priceEthPerToken,
    side, src, getEthPriceForTransfer()
  ])
  
  console.log(`✅ Token ${token.id}: Recorded ${side} transfer (${src})`)
  } catch (dbError) {
    console.error(`❌ Token ${token.id}: Database error recording ${side} transfer:`, dbError)
    throw dbError // Re-throw to skip to next token
  }
}


/**
 * Process direct RPC DEX log and insert into token_transfers
 */
async function processDexLog(
  token: TokenRow,
  dexPool: DexPoolRow,
  log: ethers.Log,
  provider: ethers.JsonRpcProvider,
  chainId: number
) {
  try {
    // Get transaction details
    const tx = await withRateLimit(() => provider.getTransaction(log.transactionHash!), MAX_RETRY_ATTEMPTS, chainId)
    if (!tx) {
      console.log(`Token ${token.id}: Could not get transaction ${log.transactionHash}`)
      return
    }

    // Get block details
    const block = await withRateLimit(() => provider.getBlock(log.blockNumber), MAX_RETRY_ATTEMPTS, chainId)
    if (!block) {
      console.log(`Token ${token.id}: Could not get block ${log.blockNumber}`)
      return
    }

    const blockTime = new Date(Number(block.timestamp) * 1000)

    // Decode swap log using UniswapV2 Swap ABI
    const swapInterface = new ethers.Interface([
      'event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)'
    ])
    
    const decoded = swapInterface.parseLog({
      topics: log.topics,
      data: log.data
    })

    if (!decoded) {
      console.log(`Token ${token.id}: Could not decode swap log`)
      return
    }

    const { sender, amount0In, amount1In, amount0Out, amount1Out, to } = decoded.args

    // Debug: Log DEX pool configuration and raw amounts
    console.log(`Token ${token.id}: DEX pool config - token0: ${dexPool.token0}, token1: ${dexPool.token1}, quote_token: ${dexPool.quote_token}`)
    console.log(`Token ${token.id}: Raw swap amounts - amount0In: ${amount0In}, amount1In: ${amount1In}, amount0Out: ${amount0Out}, amount1Out: ${amount1Out}`)
    console.log(`Token ${token.id}: Token contract: ${token.contract_address}`)

    // Get actual token addresses from the DEX pair contract to determine correct mapping
    const pair = new ethers.Contract(dexPool.pair_address, [
      'function token0() view returns (address)',
      'function token1() view returns (address)'
    ], provider)
    
    const actualToken0 = await withRateLimit(() => pair.token0(), MAX_RETRY_ATTEMPTS, chainId)
    const actualToken1 = await withRateLimit(() => pair.token1(), MAX_RETRY_ATTEMPTS, chainId)
    
    // Get WETH address from database (quote_token is always WETH)
    const wethAddress = dexPool.quote_token
    
    // Determine which amount corresponds to which token
    const isWethToken0 = actualToken0.toLowerCase() === wethAddress.toLowerCase()
    
    // Determine if this is a BUY or SELL based on actual token order
    let isBuy: boolean
    if (isWethToken0) {
      // WETH is token0, our token is token1
      // BUY: amount1Out > 0 (receiving our token)
      // SELL: amount1In > 0 (selling our token)
      isBuy = amount1Out > 0n
    } else {
      // Our token is token0, WETH is token1
      // BUY: amount0Out > 0 (receiving our token)
      // SELL: amount0In > 0 (selling our token)
      isBuy = amount0Out > 0n
    }
    
    const side = isBuy ? 'BUY' : 'SELL'

    // Calculate amounts based on actual token order
    let tokenAmount: bigint
    let ethAmount: bigint
    
    if (isWethToken0) {
      // WETH is token0, our token is token1
      if (isBuy) {
        // BUY: receiving token1 (our token), paying with token0 (WETH)
        tokenAmount = amount1Out
        ethAmount = amount0In
      } else {
        // SELL: selling token1 (our token), receiving token0 (WETH)
        tokenAmount = amount1In
        ethAmount = amount0Out
      }
    } else {
      // Our token is token0, WETH is token1
      if (isBuy) {
        // BUY: receiving token0 (our token), paying with token1 (WETH)
        tokenAmount = amount0Out
        ethAmount = amount1In
      } else {
        // SELL: selling token0 (our token), receiving token1 (WETH)
        tokenAmount = amount0In
        ethAmount = amount1Out
      }
    }

    // Debug: Log calculated amounts
    console.log(`Token ${token.id}: Actual DEX pair - token0: ${actualToken0}, token1: ${actualToken1}`)
    console.log(`Token ${token.id}: WETH address: ${wethAddress}, isWethToken0: ${isWethToken0}`)
    console.log(`Token ${token.id}: Calculated amounts - tokenAmount: ${tokenAmount}, ethAmount: ${ethAmount}`)
    console.log(`Token ${token.id}: isBuy: ${isBuy}, amount0In: ${amount0In}, amount1In: ${amount1In}, amount0Out: ${amount0Out}, amount1Out: ${amount1Out}`)

    // Check for zero values before division
    if (tokenAmount === 0n || ethAmount === 0n) {
      console.log(`Token ${token.id}: Skipping DEX transaction due to zero amount - tokenAmount: ${tokenAmount}, ethAmount: ${ethAmount}`)
      return
    }

    // Determine from/to addresses
    // For BUY: use 'to' field from Swap event (user receives tokens)
    // For SELL: use transaction 'from' field (user sends tokens)
    const userAddress = isBuy ? to : tx.from
    const fromAddress = isBuy ? dexPool.pair_address : userAddress
    const toAddress = isBuy ? userAddress : dexPool.pair_address 

    // Calculate price (ETH per token)
    const priceEthPerToken = Number(ethAmount) / Number(tokenAmount)

    console.log(`Token ${token.id}: Processing DEX ${side} - ${tokenAmount} tokens for ${ethAmount} ETH`)
    console.log(`Token ${token.id}: DEX addresses - sender: ${sender}, to: ${to}, tx.from: ${tx.from}, pair: ${dexPool.pair_address}, userAddress: ${userAddress}`)

    // Insert into token_transfers
    try {
    await pool.query(`
      INSERT INTO public.token_transfers
        (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, eth_price_usd)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [
      token.id, chainId, token.contract_address, log.blockNumber, blockTime, log.transactionHash,
      log.index,
      fromAddress,
      toAddress,
      tokenAmount.toString(), // amount_wei (token amount)
      ethAmount.toString(),   // amount_eth_wei (ETH amount)
      priceEthPerToken,
      side,
      'DEX',
      getEthPriceForTransfer()
    ])

    console.log(`Token ${token.id}: Inserted DEX ${side} record`)
    } catch (dbError) {
      console.error(`❌ Token ${token.id}: Database error recording DEX ${side}:`, dbError)
      throw dbError // Re-throw to skip to next token
    }
  } catch (error) {
    console.error(`Token ${token.id}: Error processing DEX log:`, error)
    throw error // Re-throw to stop processing and prevent cursor advancement
  }
}

/**
 * Process SYNC log and insert into pair_snapshots
 */
async function processSyncLog(
  token: TokenRow,
  dexPool: DexPoolRow,
  log: ethers.Log,
  provider: ethers.JsonRpcProvider,
  chainId: number
) {
  try {
    // Get block details
    const block = await withRateLimit(() => provider.getBlock(log.blockNumber), MAX_RETRY_ATTEMPTS, chainId)
    if (!block) {
      console.log(`Token ${token.id}: Could not get block ${log.blockNumber}`)
      return
    }

    const blockTime = new Date(Number(block.timestamp) * 1000)

    // Decode SYNC log using UniswapV2 Sync ABI
    const [r0, r1] = ethers.AbiCoder.defaultAbiCoder().decode(['uint112','uint112'], log.data)
    const reserve0 = BigInt(r0.toString())
    const reserve1 = BigInt(r1.toString())

    // Determine actual token order from the DEX pair contract
    // Get the actual token0 and token1 from the pair contract
    const pairContract = new ethers.Contract(dexPool.pair_address, [
      'function token0() view returns (address)',
      'function token1() view returns (address)'
    ], provider)
    
    const actualToken0 = await withRateLimit(() => pairContract.token0(), MAX_RETRY_ATTEMPTS, chainId)
    const actualToken1 = await withRateLimit(() => pairContract.token1(), MAX_RETRY_ATTEMPTS, chainId)
    
    // Map reserves to token and ETH based on actual pair order
    
    let reserveTokenWei: bigint
    let reserveQuoteWei: bigint
    
    if (actualToken0.toLowerCase() === token.contract_address.toLowerCase()) {
      // Our token is token0, WETH is token1
      reserveTokenWei = reserve0
      reserveQuoteWei = reserve1
    } else if (actualToken1.toLowerCase() === token.contract_address.toLowerCase()) {
      // Our token is token1, WETH is token0  
      reserveTokenWei = reserve1
      reserveQuoteWei = reserve0
    } else {
      console.log(`Token ${token.id}: Warning - token ${token.contract_address} not found in pair ${dexPool.pair_address}`)
      console.log(`Token ${token.id}: Pair tokens - token0: ${actualToken0}, token1: ${actualToken1}`)
      return
    }
    
    console.log(`Token ${token.id}: DEX pool - actual token0: ${actualToken0}, actual token1: ${actualToken1}`)
    console.log(`Token ${token.id}: Reserve mapping - reserveTokenWei: ${reserveTokenWei}, reserveQuoteWei: ${reserveQuoteWei}`)

    // Calculate price (ETH per token)
    const priceEthPerToken = 
      (Number(reserveQuoteWei) / 10 ** (dexPool.quote_decimals ?? 18)) /
      (Number(reserveTokenWei) / 10 ** (dexPool.token_decimals ?? 18))

    console.log(`Token ${token.id}: SYNC event - reserve0: ${reserve0}, reserve1: ${reserve1}, price: ${priceEthPerToken}`)

    // Insert into pair_snapshots
    try {
      await pool.query(`
        INSERT INTO public.pair_snapshots
          (chain_id, pair_address, block_number, block_time, reserve0_wei, reserve1_wei, price_eth_per_token)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (chain_id, pair_address, block_number)
        DO UPDATE SET
          block_time = EXCLUDED.block_time,
          reserve0_wei = EXCLUDED.reserve0_wei,
          reserve1_wei = EXCLUDED.reserve1_wei,
          price_eth_per_token = EXCLUDED.price_eth_per_token
      `, [
        chainId, dexPool.pair_address, log.blockNumber, blockTime,
        reserveTokenWei.toString(), reserveQuoteWei.toString(), priceEthPerToken
      ])

      console.log(`Token ${token.id}: Inserted SYNC snapshot record`)
    } catch (dbError) {
      console.error(`❌ Token ${token.id}: Database error recording SYNC snapshot:`, dbError)
      throw dbError // Re-throw to skip to next token
    }
  } catch (error) {
    console.error(`Token ${token.id}: Error processing SYNC log:`, error)
    throw error // Re-throw to stop processing and prevent cursor advancement
  }
}






// Run the worker
if (require.main === module) {
  if (HAS_TEST_FILTERS) {
    console.log('🧪 Test filters detected - running single cycle only')
    main().then(success => {
      if (!success) {
        console.log('🛑 Single cycle aborted - another worker is running')
      }
      console.log('✅ Worker V2 cycle completed successfully!')
      process.exit(0)
    }).catch(error => {
      console.error('❌ Worker V2 failed:', error)
      process.exit(1)
    })
  } else {
    console.log('🔄 No test filters - running single cycle only')
    main().then(success => {
      if (!success) {
        console.log('🛑 Single cycle aborted - another worker is running')
      }
      console.log('✅ Worker V2 cycle completed successfully!')
      process.exit(0)
    }).catch(error => {
      console.error('❌ Worker V2 failed:', error)
      process.exit(1)
    })
  }
}

export { main }
