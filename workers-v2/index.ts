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
import { withRateLimit } from './core/rateLimiting'
import { getChunkSize, SKIP_HEALTH_CHECK, HEALTH_CHECK_TIMEOUT } from './core/config'

// Event topics
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
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
  token0: string
  token1: string
  quote_token: string
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
  console.log(`🔗 Setting up provider for chain ${chainId}...`)
  const provider = providerFor(chainId)
  
  // Get all tokens for this chain
  console.log(`📊 Querying tokens for chain ${chainId}...`)
  const { rows: tokens } = await pool.query<TokenRow>(`
    SELECT id, chain_id, contract_address, deployment_block, last_processed_block, is_graduated, creator_wallet
    FROM public.tokens 
    WHERE chain_id = $1 
    ORDER BY deployment_block ASC
  `, [chainId])
  
  console.log(`📊 Found ${tokens.length} tokens for chain ${chainId}`)
  
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
      SELECT token_id, chain_id, pair_address, deployment_block, last_processed_block, token0, token1, quote_token
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
  
  for (let from = startBlock; from <= endBlock; from += chunkSize + 1) {
    const to = Math.min(from + chunkSize, endBlock)
    
    console.log(`Token ${token.id}: Processing chunk ${from} to ${to}`)
    
    try {
      // Step 1: Process transfer logs for this chunk
      await processTransferChunk(token, dexPool, provider, chainId, from, to)
      
      // Step 2: Process DEX logs for the same chunk (if graduated and DEX deployment block reached)
      if (dexPool) {
        const dexDeploymentBlock = dexPool.deployment_block || 0
        if (from >= dexDeploymentBlock) {
          console.log(`Token ${token.id}: Processing DEX logs for chunk ${from} to ${to} (DEX deployment: ${dexDeploymentBlock})`)
          await processDexLogsForChain(token, dexPool, provider, chainId, from, to)
        } else {
          console.log(`Token ${token.id}: Skipping DEX processing for chunk ${from}-${to} (before DEX deployment at ${dexDeploymentBlock})`)
        }
      }
      
      lastSuccessfulBlock = to // Update only on success
      console.log(`✅ Token ${token.id}: Successfully processed chunk ${from} to ${to}`)
    } catch (error) {
      console.error(`❌ Failed to process chunk ${from}-${to} for token ${token.id}:`, error)
      // Skip this chunk and continue to next chunk for testing
      console.log(`⏭️ Token ${token.id}: Skipping chunk ${from}-${to}, continuing to next chunk`)
      continue
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
  }), 2, chainId)
  
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
      const tx = await withRateLimit(() => provider.getTransaction(txHash), 2, chainId)
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
        const block = await withRateLimit(() => provider.getBlock(firstLog.blockNumber), 2, chainId)
        const blockTime = new Date(Number(block!.timestamp) * 1000)
        await createGraduationRecords(token, firstLog, tx, blockTime, provider, chainId)
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
  
  console.log(`Token ${token.id}: DEX cursor check - fromBlock: ${fromBlock}, toBlock: ${toBlock}, dexLastProcessed: ${dexLastProcessed}`)
  
  // Only process if this block range hasn't been processed yet
  if (toBlock <= dexLastProcessed) {
    console.log(`Token ${token.id}: DEX logs for blocks ${fromBlock}-${toBlock} already processed (cursor at ${dexLastProcessed})`)
    return
  }
  
  // Process the entire chunk range for DEX transactions
  // We don't skip blocks based on dex_last_processed_block because:
  // 1. DEX transactions can happen at any time after graduation
  // 2. We want to catch all DEX activity in the chunk range
  const actualFromBlock = fromBlock
  
  console.log(`Token ${token.id}: Processing DEX logs for blocks ${actualFromBlock} to ${toBlock}`)
  
  // Ensure proper address checksumming
  const pairAddress = ethers.getAddress(dexPool.pair_address)
  console.log(`Token ${token.id}: Using DEX pool address: ${pairAddress}`)
  console.log(`Token ${token.id}: Token contract address: ${token.contract_address}`)
  console.log(`Token ${token.id}: DEX pool record:`, dexPool)
  
  // Use direct RPC for DEX swap detection (OKLink doesn't support MegaETH testnet)
  console.log(`Token ${token.id}: Fetching DEX swaps via direct RPC for pair ${pairAddress}`)
  
  const swapLogs = await withRateLimit(() => provider.getLogs({
    address: pairAddress,
    topics: [SWAP_TOPIC],
    fromBlock: actualFromBlock,
    toBlock: toBlock
  }), 2, chainId)
  
  console.log(`Token ${token.id}: Found ${swapLogs.length} DEX swaps via direct RPC`)
  
  for (const log of swapLogs) {
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
    
  // Get transaction details with more conservative retry
  let tx: ethers.TransactionResponse | null = null
  try {
    tx = await withRateLimit(() => provider.getTransaction(log.transactionHash!), 1, chainId)
  } catch (error) {
    console.warn(`Token ${token.id}: Failed to get transaction ${log.transactionHash}, skipping: ${error}`)
    return
  }
  
  if (!tx) {
    console.log(`Token ${token.id}: No transaction found for ${log.transactionHash}`)
    return
  }
    
    // Get block timestamp
    const block = await withRateLimit(() => provider.getBlock(log.blockNumber), 2, chainId)
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
  // Check if this transaction contains graduation by looking for Graduated event
  try {
    const receipt = await withRateLimit(() => provider.getTransactionReceipt(tx.hash), 2, chainId)
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
  chainId: number
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
  
  // Find the add liquidity event to get the actual ETH amount added to the pool
  let liquidityEthAmount = 0n
  try {
    const receipt = await withRateLimit(() => provider.getTransactionReceipt(tx.hash), 2, chainId)
    if (receipt) {
      // Look for addLiquidity event or similar in the transaction receipt
      // The ETH amount should be in the transaction value or in the addLiquidity event data
      liquidityEthAmount = tx.value || 0n
      
      // If we can find the addLiquidity event, we could extract the exact amount
      // For now, using transaction value as the liquidity amount
      console.log(`Token ${token.id}: Using transaction value ${liquidityEthAmount} as liquidity ETH amount`)
    }
  } catch (error) {
    console.warn(`Could not get receipt for liquidity amount: ${error}`)
    liquidityEthAmount = tx.value || 0n
  }
  
  // Get bonding curve price at graduation
  let priceEthPerToken = 0
  try {
    const turboTokenInterface = new ethers.Interface([
      'function getCurrentPrice() view returns (uint256)'
    ])
    
    console.log(`Token ${token.id}: Getting graduation price at block ${log.blockNumber}`)
    const priceWei = await withRateLimit(() => provider.call({
      to: token.contract_address,
      data: turboTokenInterface.encodeFunctionData('getCurrentPrice'),
      blockTag: log.blockNumber
    }), 2, chainId)
    
    console.log(`Token ${token.id}: Price call result: ${priceWei}`)
    if (priceWei && priceWei !== '0x') {
      priceEthPerToken = Number(priceWei) / 1e18
      console.log(`Token ${token.id}: Calculated price: ${priceEthPerToken}`)
    } else {
      console.warn(`Token ${token.id}: Price call returned empty or invalid result: ${priceWei}`)
    }
  } catch (error) {
    console.warn(`Token ${token.id}: Could not get graduation price: ${error}`)
  }
  
  // Calculate price for user BUY record
  const userPriceEthPerToken = userEthAmount > 0n && userAmount > 0n ? Number(userEthAmount) / Number(userAmount) : 0
  
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
  
  // Record 2: Graduation Summary (contract to LP pool with graduation amounts)
  await pool.query(`
    INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, graduation_metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  `, [
    token.id, chainId, token.contract_address, log.blockNumber, blockTime, log.transactionHash,
    graduationLog.index, // Use actual log index from the original graduation log
    token.contract_address, // From contract
    lpToAddress, // To LP pool (or zero address if not found)
    graduationAmount.toString(), // Use graduation amount
    liquidityEthAmount.toString(), // Use liquidity ETH amount (from addLiquidity event)
    priceEthPerToken, // Use bonding curve price at graduation
    'GRADUATION',
    'BC', // Bonding curve operation
    JSON.stringify({
      type: 'graduation',
      phase: 'summary',
      total_tokens: graduationAmount.toString(),
      liquidity_eth: liquidityEthAmount.toString(),
      price_eth_per_token: priceEthPerToken,
      graduation_trigger: tx.from,
      user_tokens: userAmount.toString(),
      user_eth: userEthAmount.toString(),
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
    // BC operation - determine transfer type
    const transferType = determineTransferType(token, tx, fromAddress, toAddress)
    side = transferType
    
    if (transferType === 'BUY' || transferType === 'BUY&LOCK') {
      ethAmount = tx.value || 0n
      if (ethAmount > 0n && amount > 0n) {
        priceEthPerToken = Number(ethAmount) / Number(amount)
      }
    } else if (transferType === 'SELL') {
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
    const tx = await withRateLimit(() => provider.getTransaction(log.transactionHash!), 2, chainId)
    if (!tx) {
      console.log(`Token ${token.id}: Could not get transaction ${log.transactionHash}`)
      return
    }

    // Get block details
    const block = await withRateLimit(() => provider.getBlock(log.blockNumber), 2, chainId)
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

    const { sender, amount0In, amount1In, amount0Out, amount1Out } = decoded.args

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
    const fromAddress = isBuy ? dexPool.pair_address : sender
    const toAddress = isBuy ? sender : dexPool.pair_address

    // Calculate price (ETH per token)
    const priceEthPerToken = Number(ethAmount) / Number(tokenAmount)

    console.log(`Token ${token.id}: Processing DEX ${side} - ${tokenAmount} tokens for ${ethAmount} ETH`)

    // Insert into token_transfers
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
  } catch (error) {
    console.error(`Token ${token.id}: Error processing DEX log:`, error)
  }
}






// Run the worker
if (require.main === module) {
  main().catch(console.error)
}

export { main }
