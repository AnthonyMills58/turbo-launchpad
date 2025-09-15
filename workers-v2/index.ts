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
import { getChunkSize, SKIP_HEALTH_CHECK, HEALTH_CHECK_TIMEOUT, MAX_RETRY_ATTEMPTS, LOCK_NS, LOCK_ID } from './core/config'

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
async function main() {
  console.log('🚀 Starting Turbo Launchpad Worker V2...')
console.log('📋 Version: [335] - Railway deployment working correctly')
  
  // Acquire global lock to prevent overlapping runs
  const lock = await acquireGlobalLock()
  if (!lock) {
    console.log('Another worker run is in progress. Exiting.')
    await pool.end()
    return
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
        return
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
    
    console.log('\n✅ Worker V2 cycle completed successfully!')
  } catch (error) {
    console.error('❌ Worker V2 failed:', error)
    process.exit(1)
  } finally {
    // Release the global lock
    await lock.release()
    await pool.end()
  }
}

/**
 * Continuous worker loop
 */
async function runContinuousWorker() {
  console.log('🔄 Starting continuous worker loop...')
  
  while (true) {
    try {
      console.log('\n🔄 Starting new worker cycle...')
      await main()
      
      // Wait 30 seconds before next cycle
      console.log('⏳ Waiting 30 seconds before next cycle...')
      await new Promise(resolve => setTimeout(resolve, 30000))
      
    } catch (error) {
      console.error('❌ Worker cycle failed:', error)
      console.log('⏳ Waiting 60 seconds before retry...')
      await new Promise(resolve => setTimeout(resolve, 60000))
    }
  }
}

/**
 * Process all tokens for a specific chain
 */
async function processChain(chainId: number) {
  console.log(`🔗 Setting up provider for chain ${chainId}...`)
  const provider = providerFor(chainId)
  
  // Get token processing parameters
  const startToken = parseInt(process.env.START_TOKEN || '10000')
  const tokensNumber = parseInt(process.env.TOKENS_NUMBER || '10000')
  
  console.log(`📊 Looking for tokens starting from ${startToken}, processing ${tokensNumber} tokens for chain ${chainId}...`)
  
  // Find the highest available token ID that's <= startToken
  const { rows: maxTokenRows } = await pool.query(`
    SELECT MAX(id) as max_id
    FROM public.tokens 
    WHERE chain_id = $1 AND id <= $2
  `, [chainId, startToken])
  
  const actualStartToken = maxTokenRows[0]?.max_id
  if (!actualStartToken) {
    console.log(`⚠️  No tokens found for chain ${chainId} with ID <= ${startToken}`)
    return
  }
  
  console.log(`📊 Found highest available token: ${actualStartToken} (requested: ${startToken})`)
  
  // If tokensNumber is very large (like default 100000), process all available tokens
  // Otherwise, limit to the specified number
  const shouldProcessAll = tokensNumber >= 10000
  const limitClause = shouldProcessAll ? '' : `LIMIT ${tokensNumber}`
  
  if (shouldProcessAll) {
    console.log(`📊 Processing ALL available tokens starting from token ${actualStartToken}...`)
  } else {
    console.log(`📊 Processing ${tokensNumber} tokens starting from token ${actualStartToken}...`)
  }
  
  const { rows: tokens } = await pool.query<TokenRow>(`
    SELECT id, chain_id, contract_address, deployment_block, last_processed_block, is_graduated, creator_wallet
    FROM public.tokens 
    WHERE chain_id = $1 AND id <= $2
    ORDER BY id DESC
    ${limitClause}
  `, [chainId, actualStartToken])
  
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
  const chunkSize = getChunkSize(chainId)
  let lastSuccessfulBlock = startBlock - 1 // Track last successfully processed block
  let hasFinalRetryFailure = false // Track if we had a final retry failure
  let hasDexFinalRetryFailure = false // Track if we had a final retry failure in DEX processing
  
  for (let from = startBlock; from <= endBlock; from += chunkSize + 1) {
    const to = Math.min(from + chunkSize, endBlock)
    
    // Get timestamp for the last block in range for better debugging
    const toBlockInfo = await withRateLimit(() => provider.getBlock(to), 2, chainId)
    const toBlockTimestamp = toBlockInfo ? new Date(Number(toBlockInfo.timestamp) * 1000).toISOString() : 'unknown'
    console.log(`Token ${token.id}: Processing chunk ${from} to ${to} (last block timestamp: ${toBlockTimestamp})`)
    
    try {
      // Step 1: Process transfer logs for this chunk
      await processTransferChunk(token, dexPool, provider, chainId, from, to)
      
      // Step 2: Process DEX logs for the same chunk (if graduated and DEX deployment block reached)
      if (dexPool) {
        const dexDeploymentBlock = dexPool.deployment_block || 0
        if (from >= dexDeploymentBlock) {
          console.log(`Token ${token.id}: Processing DEX logs for chunk ${from} to ${to} (DEX deployment: ${dexDeploymentBlock})`)
          try {
            await processDexLogsForChain(token, dexPool, provider, chainId, from, to)
          } catch (dexError) {
            // Any error that reaches here means all retry attempts were exhausted in DEX processing
            console.log(`🔄 Token ${token.id}: All retry attempts exhausted in DEX processing`)
            hasDexFinalRetryFailure = true
            throw dexError // Re-throw to skip entire token processing
          }
          
          // Update DEX pool cursors to the end of the current chunk
          // This happens regardless of whether DEX logs were found or not, as long as no error occurred
          console.log(`🔄 Token ${token.id}: Updating DEX pool cursors to block ${to}`)
          try {
            // Use UPSERT to bypass Railway UPDATE issues
            const dexUpdateResult = await pool.query(`
              INSERT INTO public.dex_pools (token_id, chain_id, pair_address, last_processed_block, last_processed_sync_block, token0, token1, quote_token, token_decimals, weth_decimals, quote_decimals, deployment_block)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              ON CONFLICT (chain_id, pair_address) DO UPDATE SET 
                last_processed_block = EXCLUDED.last_processed_block,
                last_processed_sync_block = EXCLUDED.last_processed_sync_block
            `, [token.id, chainId, dexPool.pair_address, to, to, dexPool.token0, dexPool.token1, dexPool.quote_token, dexPool.token_decimals, dexPool.weth_decimals, dexPool.quote_decimals, dexPool.deployment_block])
            
            console.log(`✅ Token ${token.id}: Updated DEX pool cursors to block ${to} (rows affected: ${dexUpdateResult.rowCount})`)
            
            // Verify the DEX pool update actually happened
            const dexVerifyResult = await pool.query(`
              SELECT last_processed_block, last_processed_sync_block FROM public.dex_pools WHERE token_id = $1 AND chain_id = $2
            `, [token.id, chainId])
            
            if (dexVerifyResult.rows.length > 0) {
              console.log(`🔍 Token ${token.id}: Verified DEX pool cursors - SWAP: ${dexVerifyResult.rows[0].last_processed_block}, SYNC: ${dexVerifyResult.rows[0].last_processed_sync_block}`)
            }
          } catch (dexDbError) {
            console.error(`❌ Token ${token.id}: DEX pool database update failed:`, dexDbError)
            throw dexDbError
          }
        } else {
          console.log(`Token ${token.id}: Skipping DEX processing for chunk ${from}-${to} (before DEX deployment at ${dexDeploymentBlock})`)
        }
      }
      
      lastSuccessfulBlock = to // Update only on success
      
      // Update last_processed_block in database after each successful chunk
      console.log(`🔄 Token ${token.id}: Updating database last_processed_block to ${to}`)
      try {
        // Use UPSERT to bypass Railway UPDATE issues
        const updateResult = await pool.query(`
          INSERT INTO public.tokens (id, last_processed_block, name, symbol, supply, raise_target, dex, creator_wallet, chain_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id) DO UPDATE SET 
            last_processed_block = EXCLUDED.last_processed_block,
            updated_at = now()
        `, [token.id, to, `Token ${token.id}`, `TKN${token.id}`, 1000000, 100, 'uniswap', token.creator_wallet || '', token.chain_id])
        
        console.log(`✅ Token ${token.id}: Successfully processed chunk ${from} to ${to} and updated DB to block ${to} (rows affected: ${updateResult.rowCount})`)
        
        // Verify the update actually happened
        const verifyResult = await pool.query(`
          SELECT last_processed_block FROM public.tokens WHERE id = $1
        `, [token.id])
        
        if (verifyResult.rows.length > 0) {
          console.log(`🔍 Token ${token.id}: Verified last_processed_block is now ${verifyResult.rows[0].last_processed_block}`)
        }
      } catch (dbError) {
        console.error(`❌ Token ${token.id}: Database update failed:`, dbError)
        throw dbError
      }
    } catch (error) {
      console.error(`❌ Failed to process chunk ${from}-${to} for token ${token.id}:`, error)
      
      // Any error that reaches here means all retry attempts were exhausted
      // Skip the entire token to avoid getting stuck in a loop
      console.log(`🔄 Token ${token.id}: All retry attempts exhausted, skipping to next token`)
      hasFinalRetryFailure = true
      throw error // Re-throw to skip entire token processing
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
async function processDexLogsForChain(
  token: TokenRow,
  dexPool: DexPoolRow,
  provider: ethers.JsonRpcProvider,
  chainId: number,
  fromBlock: number,
  toBlock: number
) {
  // Get separate cursors for SWAP and SYNC events
  const swapLastProcessed = dexPool.last_processed_block || 0
  const syncLastProcessed = dexPool.last_processed_sync_block || 0
  
  console.log(`Token ${token.id}: DEX cursor check - fromBlock: ${fromBlock}, toBlock: ${toBlock}, swapLastProcessed: ${swapLastProcessed}, syncLastProcessed: ${syncLastProcessed}`)
  
  // Ensure proper address checksumming
  const pairAddress = ethers.getAddress(dexPool.pair_address)
  console.log(`Token ${token.id}: Using DEX pool address: ${pairAddress}`)
  console.log(`Token ${token.id}: Token contract address: ${token.contract_address}`)
  
  // Process SWAP events
  if (toBlock > swapLastProcessed) {
    const swapFromBlock = Math.max(fromBlock, swapLastProcessed + 1)
    if (swapFromBlock <= toBlock) {
      console.log(`Token ${token.id}: Processing SWAP events for blocks ${swapFromBlock} to ${toBlock}`)
      
      const swapLogs = await withRateLimit(() => provider.getLogs({
        address: pairAddress,
        topics: [SWAP_TOPIC],
        fromBlock: swapFromBlock,
        toBlock: toBlock
      }), MAX_RETRY_ATTEMPTS, chainId)
      
      console.log(`Token ${token.id}: Found ${swapLogs.length} DEX swaps`)
      
      for (const log of swapLogs) {
        await processDexLog(token, dexPool, log, provider, chainId)
      }
      
      console.log(`✅ Token ${token.id}: Processed SWAP events for blocks ${swapFromBlock} to ${toBlock}`)
    }
  } else {
    console.log(`Token ${token.id}: SWAP events already processed for blocks ${fromBlock}-${toBlock}`)
  }
  
  // Process SYNC events
  if (toBlock > syncLastProcessed) {
    const syncFromBlock = Math.max(fromBlock, syncLastProcessed + 1)
    if (syncFromBlock <= toBlock) {
      console.log(`Token ${token.id}: Processing SYNC events for blocks ${syncFromBlock} to ${toBlock}`)
      
      const syncLogs = await withRateLimit(() => provider.getLogs({
        address: pairAddress,
        topics: [SYNC_TOPIC],
        fromBlock: syncFromBlock,
        toBlock: toBlock
      }), MAX_RETRY_ATTEMPTS, chainId)
      
      console.log(`Token ${token.id}: Found ${syncLogs.length} DEX sync events`)
      
      for (const log of syncLogs) {
        await processSyncLog(token, dexPool, log, provider, chainId)
      }
      
      console.log(`✅ Token ${token.id}: Processed SYNC events for blocks ${syncFromBlock} to ${toBlock}`)
    }
  } else {
    console.log(`Token ${token.id}: SYNC events already processed for blocks ${fromBlock}-${toBlock}`)
  }
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
          
          // Determine which amount is which based on token position in DEX pair
          // We need to check if our token is token0 or token1 in the DEX pair
          if (dexPool) {
            const isToken0 = token.contract_address.toLowerCase() === dexPool.token0.toLowerCase()
            
            if (isToken0) {
              liquidityTokenAmount = amount0
              liquidityEthAmount = amount1
            } else {
              liquidityTokenAmount = amount1
              liquidityEthAmount = amount0
            }
            
            console.log(`Token ${token.id}: Found addLiquidity event - Token: ${liquidityTokenAmount}, ETH: ${liquidityEthAmount}`)
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
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  `, [
    token.id, chainId, token.contract_address, log.blockNumber, blockTime, log.transactionHash,
    userBuyLog.index, // Use actual log index from the original user buy log
    '0x0000000000000000000000000000000000000000', // From zero address (mint)
    userToAddress, // To user who triggered graduation
    userAmount.toString(),
    userEthAmount.toString(), // Use transaction value (ETH paid by user)
    userPriceEthPerToken, // Use calculated price for user transaction
    'BUY',
    'BC' // Bonding curve operation
  ])
  
  // Record 2: Graduation Summary (contract to LP pool with addLiquidity amounts)
  await pool.query(`
    INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, graduation_metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  `, [
    token.id, chainId, token.contract_address, log.blockNumber, blockTime, log.transactionHash,
    graduationLog.index, // Use actual log index from the original graduation log
    token.contract_address, // From contract
    lpToAddress, // To LP pool (or zero address if not found)
    liquidityTokenAmount.toString(), // Use actual addLiquidity token amount
    liquidityEthAmount.toString(), // Use actual addLiquidity ETH amount
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
    })
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
  // Determine if this is BC or DEX operation
  const graduationBlock = dexPool?.deployment_block || 0
  const isAfterGraduation = graduationBlock > 0 && log.blockNumber > graduationBlock
  
  let side = 'BUY' // Default
  const src = 'BC' // Default
  let ethAmount = 0n
  let priceEthPerToken = null
  
  // Determine transfer type first
  const transferType = determineTransferType(token, tx, fromAddress, toAddress)
  side = transferType
  
  if (isAfterGraduation) {
    // After graduation, only process CLAIMAIRDROP and UNLOCK transactions
    // Skip regular BC transfers (BUY/SELL) as they should be DEX operations
    if (transferType === 'CLAIMAIRDROP' || transferType === 'UNLOCK') {
      console.log(`Token ${token.id}: Processing post-graduation ${transferType} transaction at block ${log.blockNumber}`)
      // Continue processing this transaction
    } else {
      console.log(`Token ${token.id}: Transfer after graduation - skipping ${transferType} (DEX operations handled separately)`)
      return
    }
  }
  
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
        (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (chain_id, tx_hash, log_index) DO UPDATE SET
        side = EXCLUDED.side,
        src = EXCLUDED.src
    `, [
      token.id, chainId, token.contract_address, log.blockNumber, blockTime, log.transactionHash,
      log.index, fromAddress, toAddress, amount.toString(), ethAmount.toString(), priceEthPerToken,
      side, src
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

    // Determine if this is a BUY or SELL based on which token is which
    // We need to check if our token is token0 or token1 in the pair
    const isToken0 = token.contract_address.toLowerCase() === dexPool.token0.toLowerCase()
    const isToken1 = token.contract_address.toLowerCase() === dexPool.token1.toLowerCase()
    
    console.log(`Token ${token.id}: Token position - isToken0: ${isToken0}, isToken1: ${isToken1}`)

    let isBuy: boolean
    if (isToken0) {
      // Our token is token0, so:
      // BUY: amount0Out > 0 (receiving our token)
      // SELL: amount0In > 0 (selling our token)
      isBuy = amount0Out > 0n
    } else if (isToken1) {
      // Our token is token1, so:
      // BUY: amount1Out > 0 (receiving our token)
      // SELL: amount1In > 0 (selling our token)
      isBuy = amount1Out > 0n
    } else {
      console.log(`Token ${token.id}: Token not found in DEX pair, skipping`)
      return
    }
    
    const side = isBuy ? 'BUY' : 'SELL'

    // Calculate amounts based on token position
    let tokenAmount: bigint
    let ethAmount: bigint
    
    if (isToken0) {
      // Our token is token0
      if (isBuy) {
        // BUY: receiving token0, paying with token1 (ETH)
        tokenAmount = amount0Out
        ethAmount = amount1In
      } else {
        // SELL: selling token0, receiving token1 (ETH)
        tokenAmount = amount0In
        ethAmount = amount1Out
      }
    } else {
      // Our token is token1
      if (isBuy) {
        // BUY: receiving token1, paying with token0 (ETH)
        tokenAmount = amount1Out
        ethAmount = amount0In
      } else {
        // SELL: selling token1, receiving token0 (ETH)
        tokenAmount = amount1In
        ethAmount = amount0Out
      }
    }

    // Debug: Log calculated amounts
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
          (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [
        token.id, chainId, token.contract_address, log.blockNumber, blockTime, log.transactionHash,
        log.index,
        fromAddress,
        toAddress,
        tokenAmount.toString(),
        ethAmount.toString(),
        priceEthPerToken,
        side,
        'DEX'
      ])

      console.log(`Token ${token.id}: Inserted DEX ${side} record`)
    } catch (dbError) {
      console.error(`❌ Token ${token.id}: Database error recording DEX ${side}:`, dbError)
      throw dbError // Re-throw to skip to next token
    }
  } catch (error) {
    console.error(`Token ${token.id}: Error processing DEX log:`, error)
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

    // Determine which reserve is the quote token (ETH/WETH)
    const isQuoteToken0 = dexPool.quote_token.toLowerCase() === dexPool.token0.toLowerCase()
    const reserveQuoteWei = isQuoteToken0 ? reserve0 : reserve1
    const reserveTokenWei = isQuoteToken0 ? reserve1 : reserve0

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
        reserve0.toString(), reserve1.toString(), priceEthPerToken
      ])

      console.log(`Token ${token.id}: Inserted SYNC snapshot record`)
    } catch (dbError) {
      console.error(`❌ Token ${token.id}: Database error recording SYNC snapshot:`, dbError)
      throw dbError // Re-throw to skip to next token
    }
  } catch (error) {
    console.error(`Token ${token.id}: Error processing SYNC log:`, error)
  }
}






// Run the worker
if (require.main === module) {
  runContinuousWorker().catch(console.error)
}

export { main }
