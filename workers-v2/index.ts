#!/usr/bin/env node

/**
 * Turbo Launchpad Worker V2
 * 
 * New implementation with:
 * - Per-token processing loop
 * - Proper rate limiting
 * - Clean graduation logic
 * - Better error handling
 */

import { ethers } from 'ethers'
import pool from '../lib/db'
import { providerFor } from '../lib/providers'
import { withRateLimit } from './core/rateLimiting'
import { getChunkSize, getSleepMs } from './core/config'

// Event topics
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
const SYNC_TOPIC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1'

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
}

/**
 * Main worker function
 */
async function main() {
  console.log('🚀 Starting Turbo Launchpad Worker V2...')
  
  try {
    // Get all chains
    const { rows: chains } = await pool.query('SELECT DISTINCT chain_id FROM public.tokens ORDER BY chain_id')
    
    for (const { chain_id } of chains) {
      console.log(`\n📊 Processing chain ${chain_id}...`)
      await processChain(chain_id)
    }
    
    console.log('\n✅ Worker V2 completed successfully!')
  } catch (error) {
    console.error('❌ Worker V2 failed:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

/**
 * Process all tokens for a specific chain
 */
async function processChain(chainId: number) {
  const provider = providerFor(chainId)
  
  // Get all tokens for this chain
  const { rows: tokens } = await pool.query<TokenRow>(`
    SELECT id, chain_id, contract_address, deployment_block, last_processed_block, is_graduated, creator_wallet
    FROM public.tokens 
    WHERE chain_id = $1 
    ORDER BY id
  `, [chainId])
  
  console.log(`Found ${tokens.length} tokens for chain ${chainId}`)
  
  // Process each token individually
  for (const token of tokens) {
    try {
      console.log(`\n🪙 Processing token ${token.id} (${token.contract_address})...`)
      await processToken(token, provider, chainId)
    } catch (error) {
      console.error(`❌ Failed to process token ${token.id}:`, error)
      // Continue with next token instead of failing entire chain
    }
  }
}

/**
 * Process a single token
 */
async function processToken(token: TokenRow, provider: ethers.JsonRpcProvider, chainId: number) {
  const currentBlock = await withRateLimit(() => provider.getBlockNumber(), 10, chainId)
  
  // Determine processing range
  let startBlock = token.last_processed_block + 1
  let endBlock = currentBlock
  
  if (startBlock > endBlock) {
    console.log(`Token ${token.id}: Already up to date (${startBlock} > ${endBlock})`)
    return
  }
  
  console.log(`Token ${token.id}: Processing blocks ${startBlock} to ${endBlock}`)
  
  // Get DEX pool info if graduated
  let dexPool: DexPoolRow | null = null
  if (token.is_graduated) {
    const { rows } = await pool.query<DexPoolRow>(`
      SELECT token_id, chain_id, pair_address, deployment_block, last_processed_block
      FROM public.dex_pools 
      WHERE token_id = $1 AND chain_id = $2
    `, [token.id, chainId])
    
    if (rows.length > 0) {
      dexPool = rows[0]
      console.log(`Token ${token.id}: Found DEX pool ${dexPool.pair_address}`)
    }
  }
  
  // Process in chunks
  const chunkSize = getChunkSize(chainId)
  for (let from = startBlock; from <= endBlock; from += chunkSize + 1) {
    const to = Math.min(from + chunkSize, endBlock)
    
    console.log(`Token ${token.id}: Processing chunk ${from} to ${to}`)
    
    try {
      await processTokenChunk(token, dexPool, provider, chainId, from, to)
    } catch (error) {
      console.error(`❌ Failed to process chunk ${from}-${to} for token ${token.id}:`, error)
      // Continue with next chunk
    }
  }
  
  // Update last processed block
  await pool.query(`
    UPDATE public.tokens 
    SET last_processed_block = $1, updated_at = NOW()
    WHERE id = $2
  `, [endBlock, token.id])
  
  console.log(`✅ Token ${token.id}: Updated to block ${endBlock}`)
}

/**
 * Process a chunk of blocks for a token
 */
async function processTokenChunk(
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
  }), 10, chainId)
  
  console.log(`Token ${token.id}: Found ${transferLogs.length} transfer logs`)
  
  // Process each transfer log
  for (const log of transferLogs) {
    await processTransferLog(token, dexPool, log, provider, chainId)
  }
  
  // If graduated, also process DEX logs
  if (dexPool) {
    const dexLogs = await withRateLimit(() => provider.getLogs({
      address: dexPool!.pair_address,
      topics: [SWAP_TOPIC, SYNC_TOPIC],
      fromBlock,
      toBlock
    }), 10, chainId)
    
    console.log(`Token ${token.id}: Found ${dexLogs.length} DEX logs`)
    
    for (const log of dexLogs) {
      await processDexLog(token, dexPool, log, provider, chainId)
    }
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
  // TODO: Implement transfer log processing
  console.log(`Processing transfer log: ${log.transactionHash}`)
}

/**
 * Process a DEX log
 */
async function processDexLog(
  token: TokenRow,
  dexPool: DexPoolRow,
  log: ethers.Log,
  provider: ethers.JsonRpcProvider,
  chainId: number
) {
  // TODO: Implement DEX log processing
  console.log(`Processing DEX log: ${log.transactionHash}`)
}

// Run the worker
if (require.main === module) {
  main().catch(console.error)
}

export { main }
