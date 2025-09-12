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

import 'dotenv/config'
import { ethers } from 'ethers'
import pool from '../lib/db'
import { providerFor } from '../lib/providers'
import { DEX_ROUTER_BY_CHAIN, routerAbi, factoryAbi, pairAbi } from '../lib/dex'
import { withRateLimit } from './core/rateLimiting'
import { getChunkSize } from './core/config'

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
  const startBlock = token.last_processed_block + 1
  const endBlock = currentBlock
  
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
  let lastSuccessfulBlock = startBlock - 1 // Track last successfully processed block
  
  for (let from = startBlock; from <= endBlock; from += chunkSize + 1) {
    const to = Math.min(from + chunkSize, endBlock)
    
    console.log(`Token ${token.id}: Processing chunk ${from} to ${to}`)
    
    try {
      await processTokenChunk(token, dexPool, provider, chainId, from, to)
      lastSuccessfulBlock = to // Update only on success
      console.log(`✅ Token ${token.id}: Successfully processed chunk ${from} to ${to}`)
    } catch (error) {
      console.error(`❌ Failed to process chunk ${from}-${to} for token ${token.id}:`, error)
      // Stop processing on first failure to avoid data gaps
      break
    }
  }
  
  // Update last processed block only to the last successful chunk
  if (lastSuccessfulBlock >= startBlock) {
    await pool.query(`
      UPDATE public.tokens 
      SET last_processed_block = $1, updated_at = NOW()
      WHERE id = $2
    `, [lastSuccessfulBlock, token.id])
    
    console.log(`✅ Token ${token.id}: Updated to block ${lastSuccessfulBlock}`)
  } else {
    console.log(`❌ Token ${token.id}: No blocks processed successfully`)
  }
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
    // Check if this is a graduation transaction first
    const tx = await withRateLimit(() => provider.getTransaction(log.transactionHash!), 10, chainId)
    if (!tx) {
      console.log(`Token ${token.id}: No transaction found for transfer ${log.transactionHash}`)
      continue
    }
    
    const isGraduation = await detectGraduation(token, log, tx, provider, chainId)
    if (isGraduation) {
      // Process graduation (creates 2 records: BUY + GRADUATION)
      const block = await withRateLimit(() => provider.getBlock(log.blockNumber), 10, chainId)
      const blockTime = new Date(Number(block!.timestamp) * 1000)
      await createGraduationRecords(token, log, tx, blockTime, provider, chainId)
    } else {
      // Process regular transfer
      await processTransferLog(token, dexPool, log, provider, chainId)
    }
  }
  
  // If graduated, also process DEX logs (but only if not already processed for this chain)
  if (dexPool) {
    await processDexLogsForChain(token, dexPool, provider, chainId, fromBlock, toBlock)
  }
}

/**
 * Process DEX logs for a chain (only once per block range)
 */
async function processDexLogsForChain(
  token: TokenRow,
  dexPool: DexPoolRow,
  provider: ethers.JsonRpcProvider,
  chainId: number,
  fromBlock: number,
  toBlock: number
) {
  // Check if DEX logs for this block range have already been processed
  const { rows: cursorRows } = await pool.query(`
    SELECT dex_last_processed_block 
    FROM public.chain_cursors 
    WHERE chain_id = $1
  `, [chainId])
  
  if (cursorRows.length === 0) {
    console.log(`Token ${token.id}: No chain cursor found for chain ${chainId}`)
    return
  }
  
  const dexLastProcessed = cursorRows[0].dex_last_processed_block || 0
  
  // Only process if this block range hasn't been processed yet
  if (toBlock <= dexLastProcessed) {
    console.log(`Token ${token.id}: DEX logs for blocks ${fromBlock}-${toBlock} already processed`)
    return
  }
  
  // Process only the new blocks
  const actualFromBlock = Math.max(fromBlock, dexLastProcessed + 1)
  
  if (actualFromBlock > toBlock) {
    console.log(`Token ${token.id}: No new DEX blocks to process`)
    return
  }
  
  console.log(`Token ${token.id}: Processing DEX logs for blocks ${actualFromBlock} to ${toBlock}`)
  
  const dexLogs = await withRateLimit(() => provider.getLogs({
    address: dexPool.pair_address,
    topics: [SWAP_TOPIC, SYNC_TOPIC],
    fromBlock: actualFromBlock,
    toBlock
  }), 10, chainId)
  
  console.log(`Token ${token.id}: Found ${dexLogs.length} DEX logs`)
  
  for (const log of dexLogs) {
    await processDexLog(token, dexPool, log, provider, chainId)
  }
  
  // Update DEX cursor for this chain
  await pool.query(`
    UPDATE public.chain_cursors 
    SET dex_last_processed_block = $1, updated_at = NOW()
    WHERE chain_id = $2
  `, [toBlock, chainId])
  
  console.log(`✅ Token ${token.id}: Updated DEX cursor to block ${toBlock}`)
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
    
    // Get transaction details
    const tx = await withRateLimit(() => provider.getTransaction(log.transactionHash!), 10, chainId)
    if (!tx) {
      console.log(`Token ${token.id}: No transaction found for ${log.transactionHash}`)
      return
    }
    
    // Get block timestamp
    const block = await withRateLimit(() => provider.getBlock(log.blockNumber), 10, chainId)
    const blockTime = new Date(Number(block!.timestamp) * 1000)
    
    // Process regular transfer (graduation is handled in main loop)
    await processRegularTransfer(token, dexPool, log, tx, fromAddress, toAddress, amount, blockTime, chainId)
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
  // Graduation: contract mints tokens to itself
  const fromAddress = ethers.getAddress('0x' + log.topics[1].slice(26))
  const toAddress = ethers.getAddress('0x' + log.topics[2].slice(26))
  
  // Check if this is a mint to contract (graduation signature)
  if (fromAddress === '0x0000000000000000000000000000000000000000' && 
      toAddress.toLowerCase() === token.contract_address.toLowerCase()) {
    
    // Additional check: look for Graduated event in transaction receipt
    try {
      const receipt = await withRateLimit(() => provider.getTransactionReceipt(tx.hash), 10, chainId)
      if (receipt) {
        // Check for Graduated event
        const graduatedEvent = receipt.logs.find(log => 
          log.topics[0] === GRADUATED_TOPIC
        )
        return !!graduatedEvent
      }
    } catch (error) {
      console.warn(`Could not get receipt for graduation check: ${error}`)
    }
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
  chainId: number
) {
  const amount = BigInt(log.data)
  
  // Get contract balance at graduation
  const ethBalance = await withRateLimit(() => provider.getBalance(token.contract_address, log.blockNumber), 10, chainId)
  
  // Get bonding curve price at graduation
  let priceEthPerToken = 0
  try {
    const turboTokenInterface = new ethers.Interface([
      'function getCurrentPrice() view returns (uint256)'
    ])
    
    const priceWei = await withRateLimit(() => provider.call({
      to: token.contract_address,
      data: turboTokenInterface.encodeFunctionData('getCurrentPrice'),
      blockTag: log.blockNumber
    }), 10, chainId)
    
    if (priceWei && priceWei !== '0x') {
      priceEthPerToken = Number(priceWei) / 1e18
    }
  } catch (error) {
    console.warn(`Could not get graduation price: ${error}`)
  }
  
  // Record 1: User BUY (the transaction that triggered graduation)
  await pool.query(`
    INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  `, [
    token.id, chainId, token.contract_address, log.blockNumber, blockTime, log.transactionHash,
    1, // log_index 1 for user BUY
    tx.from, // User who triggered graduation
    token.contract_address, // Contract receives tokens
    amount.toString(),
    ethBalance.toString(),
    priceEthPerToken,
    'BUY',
    'BC' // Bonding curve operation
  ])
  
  // Record 2: Graduation Summary (same amounts and price as BUY)
  await pool.query(`
    INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, graduation_metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  `, [
    token.id, chainId, token.contract_address, log.blockNumber, blockTime, log.transactionHash,
    0, // log_index 0 for graduation summary
    '0x0000000000000000000000000000000000000000', // From zero address (mint)
    token.contract_address, // To contract (graduation target)
    amount.toString(),
    ethBalance.toString(),
    priceEthPerToken,
    'GRADUATION',
    'BC', // Bonding curve operation
    JSON.stringify({
      type: 'graduation',
      phase: 'summary',
      total_tokens: amount.toString(),
      total_eth: ethBalance.toString(),
      price_eth_per_token: priceEthPerToken,
      graduation_trigger: tx.from,
      lp_address: null, // Will be populated when DEX pool is discovered
      reserves: null // Will be populated when DEX pool is processed
    })
  ])
  
  console.log(`✅ Token ${token.id}: Created 2 graduation records (BUY + GRADUATION)`)
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
  chainId: number
) {
  // Determine if this is BC or DEX operation
  const graduationBlock = dexPool?.deployment_block || 0
  const isAfterGraduation = log.blockNumber > graduationBlock
  
  let side = 'BUY' // Default
  const src = 'BC' // Default
  let ethAmount = 0n
  let priceEthPerToken = null
  
  if (isAfterGraduation) {
    // This should be a DEX operation, but we're processing transfer logs
    // DEX operations are handled in processDexLog
    console.log(`Token ${token.id}: Transfer after graduation - skipping (DEX operations handled separately)`)
    return
  } else {
    // BC operation - determine BUY/SELL
    if (tx.value && tx.value > 0n) {
      // ETH sent to contract = BUY
      side = 'BUY'
      ethAmount = tx.value
      priceEthPerToken = Number(ethAmount) / Number(amount)
    } else {
      // No ETH = SELL or other operation
      side = 'SELL'
      // For SELL, we'd need to call getSellPrice, but for now just record the transfer
    }
  }
  
  // Insert transfer record
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
  try {
    if (log.topics[0] === SWAP_TOPIC) {
      await processSwapLog(token, dexPool, log, provider, chainId)
    } else if (log.topics[0] === SYNC_TOPIC) {
      await processSyncLog(token, dexPool, log, provider, chainId)
    }
  } catch (error) {
    console.error(`❌ Failed to process DEX log ${log.transactionHash}:`, error)
  }
}

/**
 * Process a Swap log (DEX BUY/SELL)
 */
async function processSwapLog(
  token: TokenRow,
  dexPool: DexPoolRow,
  log: ethers.Log,
  provider: ethers.JsonRpcProvider,
  chainId: number
) {
  // Parse swap log
  const amount0In = BigInt(log.data.slice(2, 66))
  const amount1In = BigInt('0x' + log.data.slice(66, 130))
  const amount0Out = BigInt('0x' + log.data.slice(130, 194))
  const amount1Out = BigInt('0x' + log.data.slice(194, 258))
  // const to = ethers.getAddress('0x' + log.topics[2].slice(26)) // Not used in current logic
  
  // Get transaction details
  const tx = await withRateLimit(() => provider.getTransaction(log.transactionHash!), 10, chainId)
  if (!tx) {
    console.log(`Token ${token.id}: No transaction found for DEX swap ${log.transactionHash}`)
    return
  }
  
  // Get block timestamp
  const block = await withRateLimit(() => provider.getBlock(log.blockNumber), 10, chainId)
  const blockTime = new Date(Number(block!.timestamp) * 1000)
  
  // Determine swap direction and amounts
  let side: string
  let fromAddress: string
  let toAddress: string
  let amountWei: string
  let ethAmountWei: string
  let priceEthPerToken: number | null = null
  
  // Check if this is a token buy or sell
  // For token buy: amount0In > 0 (ETH in), amount1Out > 0 (tokens out)
  // For token sell: amount1In > 0 (tokens in), amount0Out > 0 (ETH out)
  
  if (amount0In > 0n && amount1Out > 0n) {
    // Token BUY: ETH in, tokens out
    side = 'BUY'
    fromAddress = dexPool.pair_address // LP pool provides tokens
    toAddress = tx.from // Trader receives tokens
    amountWei = amount1Out.toString() // Tokens received
    ethAmountWei = amount0In.toString() // ETH paid
    priceEthPerToken = Number(ethAmountWei) / Number(amountWei)
  } else if (amount1In > 0n && amount0Out > 0n) {
    // Token SELL: tokens in, ETH out
    side = 'SELL'
    fromAddress = tx.from // Trader provides tokens
    toAddress = dexPool.pair_address // LP pool receives tokens
    amountWei = amount1In.toString() // Tokens sold
    ethAmountWei = amount0Out.toString() // ETH received
    priceEthPerToken = Number(ethAmountWei) / Number(amountWei)
  } else {
    console.log(`Token ${token.id}: Unknown swap direction for ${log.transactionHash}`)
    return
  }
  
  // Insert DEX transfer record
  await pool.query(`
    INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (chain_id, tx_hash, log_index) DO UPDATE SET
      side = EXCLUDED.side,
      src = EXCLUDED.src
  `, [
    token.id, chainId, token.contract_address, log.blockNumber, blockTime, log.transactionHash,
    log.index, fromAddress, toAddress, amountWei, ethAmountWei, priceEthPerToken,
    side, 'DEX' // DEX operation
  ])
  
  console.log(`✅ Token ${token.id}: Recorded DEX ${side} (${amountWei} tokens, ${ethAmountWei} ETH)`)
}

/**
 * Process a Sync log (reserve updates)
 */
async function processSyncLog(
  token: TokenRow,
  dexPool: DexPoolRow,
  log: ethers.Log,
  provider: ethers.JsonRpcProvider,
  chainId: number
) {
  // Parse sync log
  const reserve0 = BigInt(log.data.slice(2, 66))
  const reserve1 = BigInt('0x' + log.data.slice(66, 130))
  
  // Get block timestamp
  const block = await withRateLimit(() => provider.getBlock(log.blockNumber), 10, chainId)
  const blockTime = new Date(Number(block!.timestamp) * 1000)
  
  // Calculate price from reserves
  let priceEthPerToken: number | null = null
  if (reserve0 > 0n && reserve1 > 0n) {
    // Assuming token0 is ETH and token1 is the token
    // Price = reserve0 / reserve1 (ETH per token)
    priceEthPerToken = Number(reserve0) / Number(reserve1)
  }
  
  // Insert pair snapshot
  await pool.query(`
    INSERT INTO public.pair_snapshots
      (chain_id, pair_address, block_number, block_time, reserve0_wei, reserve1_wei, price_eth_per_token)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (chain_id, pair_address, block_number) DO UPDATE SET
      reserve0_wei = EXCLUDED.reserve0_wei,
      reserve1_wei = EXCLUDED.reserve1_wei,
      price_eth_per_token = EXCLUDED.price_eth_per_token
  `, [
    chainId, dexPool.pair_address, log.blockNumber, blockTime,
    reserve0.toString(), reserve1.toString(), priceEthPerToken
  ])
  
  console.log(`✅ Token ${token.id}: Updated pair snapshot (reserves: ${reserve0}, ${reserve1})`)
}

// Run the worker
if (require.main === module) {
  main().catch(console.error)
}

export { main }
