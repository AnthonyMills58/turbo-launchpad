import 'dotenv/config'
import { ethers } from 'ethers'
import type { Log } from 'ethers'
import type { PoolClient } from 'pg'
import pool from '../lib/db'
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from '../lib/chains'
import { runPoolsPipelineForChain } from './pools'
import { runAggPipelineForChain } from './agg'

// -------------------- Config --------------------
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)')
const ZERO = '0x0000000000000000000000000000000000000000'

// Optional: limit to one token for smoke tests (NOT used in chain-batched mode)
const ONLY_TOKEN_ID = process.env.TOKEN_ID ? Number(process.env.TOKEN_ID) : undefined

// Tunables
const DEFAULT_CHUNK = Number(process.env.WORKER_CHUNK ?? 50000)         // blocks per query
const HEADER_SLEEP_MS = Number(process.env.WORKER_SLEEP_MS ?? 15)       // ms between getBlock calls
const REORG_CUSHION = Math.max(0, Number(process.env.REORG_CUSHION ?? 5))
const ADDR_BATCH_LIMIT = Math.max(1, Number(process.env.ADDR_BATCH_LIMIT ?? 200)) // addresses per getLogs
const SKIP_HEALTH_CHECK = process.env.SKIP_HEALTH_CHECK === 'true'      // skip chain health checks
const HEALTH_CHECK_TIMEOUT = Number(process.env.HEALTH_CHECK_TIMEOUT ?? 10000) // health check timeout in ms

// Singleton advisory lock (prevent overlapping runs)
const LOCK_NS = 42
const LOCK_ID = 1

// RPCs per chain (prefer env override, fall back to lib/chains)
const rpcByChain: Record<number, string> = {
  6342: process.env.MEGAETH_RPC_URL ?? megaethTestnet.rpcUrls.default.http[0],
  9999: process.env.MEGAETH_MAINNET_RPC ?? megaethMainnet.rpcUrls.default.http[0],
  11155111: process.env.SEPOLIA_RPC_URL ?? sepoliaTestnet.rpcUrls.default.http[0],
}

function providerFor(chainId: number) {
  const url = rpcByChain[chainId]
  if (!url) throw new Error(`No RPC for chain ${chainId}`)
  return new ethers.JsonRpcProvider(url, { chainId, name: `chain-${chainId}` })
}

function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms))
}

type RpcLikeError = { code?: number; message?: string; error?: { code?: number; message?: string } }
function isRateLimit(err: unknown): boolean {
  const e = err as RpcLikeError
  const code = e?.code ?? e?.error?.code
  const msg = (e?.message ?? e?.error?.message ?? '').toLowerCase()
  return code === -32016 || msg.includes('rate limit')
}

async function findBlockByTimestamp(p: ethers.JsonRpcProvider, targetTsSec: number) {
  let lo = 0
  let hi = await p.getBlockNumber()
  const latest = await p.getBlock(hi)
  if (!latest || targetTsSec >= Number(latest.timestamp)) return hi
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const b = await p.getBlock(mid)
    if (!b) { hi = mid; continue }
    if (Number(b.timestamp) < targetTsSec) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

// -------------------- DB shapes --------------------
type TokenRow = {
  id: number
  chain_id: number
  contract_address: string | null
  created_at: string | null
  deployment_block: number | null
  last_processed_block: number | null
  creator_wallet: string | null
}

type ChainCursorRow = {
  chain_id: number
  last_processed_block: number
}

// -------------------- DB helpers --------------------
async function fetchTokens(): Promise<TokenRow[]> {
  const base = `
    SELECT id, chain_id, contract_address, created_at, deployment_block, last_processed_block, creator_wallet
    FROM public.tokens
    WHERE contract_address IS NOT NULL
  `
  const sql = ONLY_TOKEN_ID ? base + ' AND id = $1' : base
  const params = ONLY_TOKEN_ID ? [ONLY_TOKEN_ID] : []
  const { rows } = await pool.query(sql, params)
  return rows
}

async function fetchChainCursors(): Promise<Map<number, number>> {
  const { rows } = await pool.query<ChainCursorRow>(`SELECT chain_id, last_processed_block FROM public.chain_cursors`)
  const m = new Map<number, number>()
  for (const r of rows) m.set(r.chain_id, r.last_processed_block)
  return m
}

async function upsertChainCursor(chainId: number, last: number) {
  await pool.query(
    `INSERT INTO public.chain_cursors (chain_id, last_processed_block, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chain_id) DO UPDATE
     SET last_processed_block = EXCLUDED.last_processed_block,
         updated_at = NOW()`,
    [chainId, last]
  )
}

function addrFromTopic(topic: string): string {
  return ('0x' + topic.slice(26)).toLowerCase()
}

// -------------------- Chain Health Detection --------------------
async function checkChainHealth(chainId: number, provider: ethers.JsonRpcProvider): Promise<boolean> {
  try {
    console.log(`Checking health for chain ${chainId}...`)
    
    // Try to get the latest block number with a timeout
    const latestBlock = await Promise.race([
      provider.getBlockNumber(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Health check timeout')), HEALTH_CHECK_TIMEOUT)
      )
    ])
    
    // Try to get block details to ensure the chain is actually responding
    const block = await Promise.race([
      provider.getBlock(latestBlock),
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

async function getHealthyChains(tokensByChain: Map<number, TokenRow[]>): Promise<Map<number, TokenRow[]>> {
  const healthyChains = new Map<number, TokenRow[]>()
  
  for (const [chainId, tokens] of tokensByChain) {
    try {
      const provider = providerFor(chainId)
      const isHealthy = await checkChainHealth(chainId, provider)
      
      if (isHealthy) {
        healthyChains.set(chainId, tokens)
        console.log(`✅ Chain ${chainId}: Healthy - will process ${tokens.length} tokens`)
      } else {
        console.log(`❌ Chain ${chainId}: Unhealthy - skipping ${tokens.length} tokens`)
      }
    } catch (error) {
      console.error(`❌ Chain ${chainId}: Health check error - ${error}`)
    }
  }
  
  return healthyChains
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

// -------------------- Timestamp cache --------------------
const tsCache = new Map<number, number>()
function cacheTs(bn: number, ts: number) {
  tsCache.set(bn, ts)
  if (tsCache.size > 2000) {
    const it = tsCache.keys().next()
    if (!it.done && it.value !== undefined) tsCache.delete(it.value as number)
  }
}

async function fetchBlockTimestamps(
  provider: ethers.JsonRpcProvider,
  blockNumbers: number[]
): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  for (const bn of blockNumbers) {
    if (tsCache.has(bn)) {
      out.set(bn, tsCache.get(bn)!)
      continue
    }
    let attempts = 0
   
    while (true) {
      try {
        const b = await provider.getBlock(bn)
        if (b) {
          const ts = Number(b.timestamp)
          out.set(bn, ts)
          cacheTs(bn, ts)
        }
        await sleep(HEADER_SLEEP_MS)
        break
      } catch (e) {
        attempts++
        if (isRateLimit(e) && attempts <= 5) {
          const backoff = Math.min(1000 * attempts, 5000)
          await sleep(backoff)
          continue
        }
        throw e
      }
    }
  }
  return out
}

// -------------------- Per-chain batched scan --------------------
async function ensureDeploymentBlock(provider: ethers.JsonRpcProvider, t: TokenRow): Promise<number> {
  if (t.deployment_block != null) return t.deployment_block
  const tsSec = t.created_at ? Math.floor(new Date(t.created_at).getTime() / 1000) : 0
  const start = await findBlockByTimestamp(provider, tsSec)
  await pool.query(`UPDATE public.tokens SET deployment_block = $1 WHERE id = $2`, [start, t.id])
  return start
}

function chunkAddresses<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// Identify the type of transfer based on transaction and addresses
async function identifyTransferType(
  tx: ethers.TransactionResponse | null, 
  fromAddr: string, 
  toAddr: string, 
  chainId: number, 
  tokenAddr: string,
  creatorWallet: string | null
): Promise<string> {
  if (!tx) return 'OTHER'
  
  // Check if it's a contract call (has data)
  if (tx.data && tx.data !== '0x' && tx.data.length >= 10) {
    // Try to decode the function call
    try {
      // Common function selectors for TurboToken
      const functionSelectors = {
        '0x3ec5b71f': 'BUY',           // buy(uint256 amount)
        '0x3a7e97c6': 'SELL',          // sell(uint256 amount) 
        '0x5b88349d': 'CLAIMAIRDROP',  // claimAirdrop()
        '0xb4105e06': 'UNLOCK',        // unlockCreatorTokens()
        '0x0ae33023': 'BUY&LOCK',      // creatorBuy(uint256 amount)
      }
      
      const selector = tx.data.slice(0, 10)
      const functionName = functionSelectors[selector as keyof typeof functionSelectors]
      
      if (functionName) {
        return functionName
      } else {
        // Debug: log unknown function selectors
        console.log(`Unknown function selector: ${selector} for tx ${tx.hash}`)
      }
    } catch {
      // Ignore decoding errors
    }
  } else if (tx.data && tx.data !== '0x') {
    // Debug: log transactions with data but not enough for a selector
    console.log(`Transaction with short data: ${tx.data} for tx ${tx.hash}`)
  }
  
  // Check for specific transfer patterns using address patterns (more reliable)
  if (fromAddr === '0x0000000000000000000000000000000000000000') {
    // Mint from zero address
    if (toAddr === tokenAddr.toLowerCase()) {
      return 'GRADUATION' // Graduation mint to contract
    }
    // Check if this is a creator buy (mint to contract, then to creator)
    if (tx.value && tx.value > 0n) {
      // Check if transaction is from the creator wallet
      if (creatorWallet && tx.from && tx.from.toLowerCase() === creatorWallet.toLowerCase()) {
        console.log(`DEBUG: Creator transaction detected: tx=${tx.hash}, creator=${creatorWallet}, from=${tx.from}`)
        return 'BUY&LOCK' // Creator buy operation
      }
      return 'BUY' // Regular buy (mint to user with ETH)
    }
    return 'TRANSFER' // Regular token creation (mint without ETH)
  }
  
  if (toAddr === '0x0000000000000000000000000000000000000000') {
    // Burn to zero address
    if (tx.value && tx.value > 0n) {
      return 'SELL' // Sell operation (burn with ETH payout)
    }
    return 'TRANSFER' // Regular token destruction (burn)
  }
  
  if (fromAddr === tokenAddr.toLowerCase()) {
    return 'UNLOCK' // From contract (unlock, etc.)
  }
  
  if (toAddr === tokenAddr.toLowerCase()) {
    return 'SELL' // To contract (sell, etc.)
  }
  
  // Fallback: if transaction has ETH value, it might be a BUY
  if (tx.value && tx.value > 0n) {
    return 'BUY' // ETH sent to contract (fallback BUY)
  }
  
  return 'TRANSFER' // Regular token transfer
}

// Clean up overlapping records between token_transfers and token_trades
async function cleanupOverlappingTransfers(chainId: number) {
  console.log(`\n=== Cleaning up overlapping transfers for chain ${chainId} ===`)
  
  // Count overlapping records first
  const { rows: overlapCount } = await pool.query(
    `SELECT COUNT(*) as count
     FROM public.token_transfers tt
     JOIN public.token_trades tr ON (
       tt.chain_id = tr.chain_id 
       AND tt.block_number = tr.block_number 
       AND tt.tx_hash = tr.tx_hash
     )
     WHERE tt.chain_id = $1`,
    [chainId]
  )
  
  const count = parseInt(overlapCount[0].count)
  console.log(`Found ${count} overlapping records in chain ${chainId}`)
  
  if (count > 0) {
    // Remove overlapping records from token_transfers
    // These are DEX operations that should only exist in token_trades
    const { rowCount } = await pool.query(
      `DELETE FROM public.token_transfers 
       WHERE chain_id = $1 
       AND (chain_id, block_number, tx_hash) IN (
         SELECT DISTINCT tt.chain_id, tt.block_number, tt.tx_hash
         FROM public.token_transfers tt
         JOIN public.token_trades tr ON (
           tt.chain_id = tr.chain_id 
           AND tt.block_number = tr.block_number 
           AND tt.tx_hash = tr.tx_hash
         )
         WHERE tt.chain_id = $1
       )`,
      [chainId]
    )
    
    console.log(`Removed ${rowCount} overlapping records from token_transfers`)
  }
}

// Backfill price data for existing transfers
async function backfillTransferPrices(chainId: number, provider: ethers.JsonRpcProvider) {
  console.log(`\n=== Backfilling transfer prices for chain ${chainId} ===`)
  
  const { rows } = await pool.query(
    `SELECT tx_hash, log_index, amount_wei, token_id, side, from_address, to_address, contract_address
     FROM public.token_transfers 
     WHERE chain_id = $1 AND (amount_eth_wei IS NULL OR price_eth_per_token IS NULL)
     ORDER BY block_number DESC 
     LIMIT 100`,
    [chainId]
  )
  
  console.log(`Found ${rows.length} transfers without price data`)
  
  for (const row of rows) {
    try {
      const tx = await provider.getTransaction(row.tx_hash)
      
      // Get transfer type for this transaction using actual addresses from the database
      const fromAddr = row.from_address || '0x0000000000000000000000000000000000000000'
      const toAddr = row.to_address || '0x0000000000000000000000000000000000000000'
      const tokenAddr = row.contract_address || '0x0000000000000000000000000000000000000000'
      
      // Get creator wallet for this token
      const { rows: tokenRows } = await pool.query(
        'SELECT creator_wallet FROM public.tokens WHERE id = $1',
        [row.token_id]
      )
      const creatorWallet = tokenRows[0]?.creator_wallet || null
      
      const transferType = await identifyTransferType(tx, fromAddr, toAddr, chainId, tokenAddr, creatorWallet)
      
      if (tx?.value && tx.value > 0n) {
        // Buy operation: ETH sent TO contract
        const ethAmount = tx.value
        const price = Number(ethAmount) / Number(row.amount_wei)
        
        await pool.query(
          `UPDATE public.token_transfers 
           SET amount_eth_wei = $1, price_eth_per_token = $2, side = $3
           WHERE chain_id = $4 AND tx_hash = $5 AND log_index = $6`,
          [ethAmount.toString(), price, transferType, chainId, row.tx_hash, row.log_index]
        )
        
        console.log(`Backfilled ${transferType}: token ${row.token_id}, tx ${row.tx_hash}, eth ${ethAmount.toString()}, price ${price}`)
      } else if (transferType === 'SELL') {
        // For SELL operations, try to get the sell price even if tx.value is 0
        // This handles the case where the sell price calculation failed during initial processing
        try {
          const receipt = await provider.getTransactionReceipt(row.tx_hash)
          if (receipt) {
            const blockBeforeTx = receipt.blockNumber - 1
            
            try {
              const turboTokenInterface = new ethers.Interface([
                'function getSellPrice(uint256 amount) view returns (uint256)'
              ])
              
              const sellPriceResult = await provider.call({
                to: row.contract_address,
                data: turboTokenInterface.encodeFunctionData('getSellPrice', [row.amount_wei.toString()]),
                blockTag: blockBeforeTx
              })
              
              if (sellPriceResult && sellPriceResult !== '0x') {
                const decoded = turboTokenInterface.decodeFunctionResult('getSellPrice', sellPriceResult)
                const sellPrice = BigInt(decoded[0].toString())
                
                if (sellPrice > 0n) {
                  const price = Number(sellPrice) / Number(row.amount_wei)
                  
                  await pool.query(
                    `UPDATE public.token_transfers 
                     SET amount_eth_wei = $1, price_eth_per_token = $2, side = $3
                     WHERE chain_id = $4 AND tx_hash = $5 AND log_index = $6`,
                    [sellPrice.toString(), price, transferType, chainId, row.tx_hash, row.log_index]
                  )
                  
                  console.log(`Backfilled SELL: token ${row.token_id}, tx ${row.tx_hash}, eth ${sellPrice.toString()}, price ${price}`)
                } else {
                  // Update side field even if sell price is 0
                  await pool.query(
                    `UPDATE public.token_transfers 
                     SET side = $1
                     WHERE chain_id = $2 AND tx_hash = $3 AND log_index = $4`,
                    [transferType, chainId, row.tx_hash, row.log_index]
                  )
                  
                  console.log(`Updated side to ${transferType}: token ${row.token_id}, tx ${row.tx_hash} (sell price was 0)`)
                }
              } else {
                // Update side field if sell price call failed
                await pool.query(
                  `UPDATE public.token_transfers 
                   SET side = $1
                   WHERE chain_id = $2 AND tx_hash = $3 AND log_index = $4`,
                  [transferType, chainId, row.tx_hash, row.log_index]
                )
                
                console.log(`Updated side to ${transferType}: token ${row.token_id}, tx ${row.tx_hash} (sell price call failed)`)
              }
            } catch (callError) {
              console.log(`Could not call getSellPrice for backfill tx ${row.tx_hash}:`, callError)
              // Update side field even if call failed
              await pool.query(
                `UPDATE public.token_transfers 
                 SET side = $1
                 WHERE chain_id = $2 AND tx_hash = $3 AND log_index = $4`,
                [transferType, chainId, row.tx_hash, row.log_index]
              )
              
              console.log(`Updated side to ${transferType}: token ${row.token_id}, tx ${row.tx_hash} (sell price call error)`)
            }
          } else {
            // Update side field if no receipt
            await pool.query(
              `UPDATE public.token_transfers 
               SET side = $1
               WHERE chain_id = $2 AND tx_hash = $3 AND log_index = $4`,
              [transferType, chainId, row.tx_hash, row.log_index]
            )
            
            console.log(`Updated side to ${transferType}: token ${row.token_id}, tx ${row.tx_hash} (no receipt)`)
          }
        } catch (receiptError) {
          console.warn(`Could not get receipt for backfill sell tx ${row.tx_hash}:`, receiptError)
          // Update side field even if receipt failed
          await pool.query(
            `UPDATE public.token_transfers 
             SET side = $1
             WHERE chain_id = $2 AND tx_hash = $3 AND log_index = $4`,
            [transferType, chainId, row.tx_hash, row.log_index]
          )
          
          console.log(`Updated side to ${transferType}: token ${row.token_id}, tx ${row.tx_hash} (receipt error)`)
        }
      } else {
        // Update side field even if we can't get ETH amount
        await pool.query(
          `UPDATE public.token_transfers 
           SET side = $1
           WHERE chain_id = $2 AND tx_hash = $3 AND log_index = $4`,
          [transferType, chainId, row.tx_hash, row.log_index]
        )
        
        console.log(`Updated side to ${transferType}: token ${row.token_id}, tx ${row.tx_hash}`)
      }
    } catch (e) {
      console.warn(`Could not backfill tx ${row.tx_hash}:`, e)
    }
  }
}

async function processChain(chainId: number, tokens: TokenRow[]) {
  if (tokens.length === 0) return

  const provider = providerFor(chainId)
  const latest = await provider.getBlockNumber()

  // Build address list & mapping (lowercased)
  const addrToTokenId = new Map<string, number>()
  const addresses: string[] = []
  for (const t of tokens) {
    if (!t.contract_address) continue
    const a = t.contract_address.toLowerCase()
    addrToTokenId.set(a, t.id)
    addresses.push(a)
  }
  if (addresses.length === 0) return

  // Compute starting block for this chain:
  // - existing chain cursor (rewound by REORG_CUSHION)
  // - capped by the MIN of token deployment blocks (to avoid scanning before any token exists)
  const cursors = await fetchChainCursors()
  let start = cursors.has(chainId) ? Math.max(cursors.get(chainId)! - REORG_CUSHION, 0) : 0

  // If no cursor yet, compute min deployment across tokens (fill missing using created_at)
  if (!cursors.has(chainId)) {
    let minDep = Number.MAX_SAFE_INTEGER
    for (const t of tokens) {
      if (!t.contract_address) continue
      const dep = await ensureDeploymentBlock(provider, t)
      if (dep < minDep) minDep = dep
    }
    if (!Number.isFinite(minDep)) minDep = 0
    start = Math.max(minDep - REORG_CUSHION, 0)
  }

  if (start > latest) {
    console.log(`Chain ${chainId}: up to date (start ${start} > latest ${latest})`)
    return
  }

  const addrBatches = chunkAddresses(addresses, ADDR_BATCH_LIMIT)

  let chunk = DEFAULT_CHUNK
  for (let from = start; from <= latest; from += chunk + 1) {
    const to = Math.min(from + chunk, latest)
    console.log(`Chain ${chainId}: scanning blocks ${from}..${to} across ${addresses.length} addresses`)

    // Collect logs across address batches
    let allLogs: Log[] = []
    try {
      for (const batch of addrBatches) {
        // Guard: provider.getLogs supports address: string|string[]
        const logs = await provider.getLogs({
          address: batch as unknown as string[], // v6 types allow string|string[]
          topics: [TRANSFER_TOPIC],
          fromBlock: from,
          toBlock: to,
        })
        allLogs = allLogs.concat(logs)
      }
    } catch (e) {
      if (isRateLimit(e) && chunk > 5000) {
        chunk = Math.floor(chunk / 2)
        console.warn(`Rate limit on getLogs(chain ${chainId}); shrinking chunk to ${chunk} and retrying`)
        from -= (chunk + 1) // retry same window with smaller chunk
        continue
      }
      throw e
    }

    // Timestamps per unique block
    const blockNums = Array.from(new Set(allLogs.map(l => l.blockNumber!))).sort((a,b)=>a-b)
    let tsByBlock = new Map<number, number>()
    try {
      tsByBlock = await fetchBlockTimestamps(provider, blockNums)
    } catch (e) {
      if (isRateLimit(e)) {
        console.warn(`Rate limit on getBlock(chain ${chainId}); using now() as fallback for this chunk`)
      } else {
        throw e
      }
    }

    // DB transaction for this chunk
    const client = await pool.connect()
    const touchedTokenIds = new Set<number>()
    try {
      await client.query('BEGIN')

      for (const log of allLogs) {
        const tokenAddr = (log.address || '').toLowerCase()
        const tokenId = addrToTokenId.get(tokenAddr)
        if (!tokenId) continue // (unlikely) address not in our list anymore
        touchedTokenIds.add(tokenId)

        const fromAddr = addrFromTopic(log.topics[1])
        const toAddr   = addrFromTopic(log.topics[2])
        const amount   = BigInt(log.data)
        const bn       = log.blockNumber!
        const ts       = tsByBlock.get(bn) ?? Math.floor(Date.now() / 1000)

        // Get ETH amount from transaction
        let ethAmount = 0n
        let price = null
        let isPaymentTransfer = false
        let transferType = 'OTHER'
        
        try {
          const tx = await provider.getTransaction(log.transactionHash!)
          // Get creator wallet for this token
          const token = tokens.find(t => t.id === tokenId)
          const creatorWallet = token?.creator_wallet || null
          transferType = await identifyTransferType(tx, fromAddr, toAddr, chainId, tokenAddr, creatorWallet)
          
          // Debug: log transaction details for ETH transactions
          if (tx?.value && tx.value > 0n) {
            console.log(`DEBUG: ETH transaction ${log.transactionHash}: value=${tx.value.toString()}, data=${tx.data}, to=${tx.to}, from=${tx.from}`)
          }
          
          if (tx?.value && tx.value > 0n) {
            // Buy operation: ETH sent TO contract
            ethAmount = tx.value
            isPaymentTransfer = true
            if (amount > 0n) {
              price = Number(ethAmount) / Number(amount)
            }
            console.log(`Token ${tokenId}: BUY tx=${log.transactionHash}, eth=${ethAmount.toString()}, tokens=${amount.toString()}, price=${price}`)
          } else if (transferType === 'SELL') {
            // Sell operation: user sends tokens to contract, receives ETH
            // Try to calculate the sell price by calling getSellPrice at the transaction block
            try {
              const receipt = await provider.getTransactionReceipt(log.transactionHash!)
              if (receipt) {
                // Call getSellPrice at the block before the transaction
                // This gives us the price that was used for this sell
                const blockBeforeTx = receipt.blockNumber - 1
                
                try {
                  // Create interface for TurboToken contract
                  const turboTokenInterface = new ethers.Interface([
                    'function getSellPrice(uint256 amount) view returns (uint256)'
                  ])
                  
                  const sellPriceResult = await provider.call({
                    to: tokenAddr,
                    data: turboTokenInterface.encodeFunctionData('getSellPrice', [amount.toString()]),
                    blockTag: blockBeforeTx
                  })
                  
                  if (sellPriceResult && sellPriceResult !== '0x') {
                    const decoded = turboTokenInterface.decodeFunctionResult('getSellPrice', sellPriceResult)
                    const sellPrice = BigInt(decoded[0].toString())
                    
                    if (sellPrice > 0n) {
                      ethAmount = sellPrice
                      isPaymentTransfer = true
                      price = Number(ethAmount) / Number(amount)
                      console.log(`Token ${tokenId}: SELL tx=${log.transactionHash}, eth=${ethAmount.toString()}, tokens=${amount.toString()}, price=${price}`)
                    } else {
                      console.log(`Token ${tokenId}: SELL tx=${log.transactionHash}, getSellPrice returned 0 for amount=${amount.toString()}`)
                    }
                  } else {
                    console.log(`Token ${tokenId}: SELL tx=${log.transactionHash}, getSellPrice call returned empty result`)
                  }
                } catch (callError) {
                  console.log(`Could not call getSellPrice for tx ${log.transactionHash}:`, callError)
                }
              } else {
                console.log(`Token ${tokenId}: SELL tx=${log.transactionHash}, could not get transaction receipt`)
              }
            } catch (receiptError) {
              console.warn(`Could not get receipt for sell tx ${log.transactionHash}:`, receiptError)
            }
            
            // For SELL operations, we still mark as payment transfer even if price calculation failed
            // This ensures the transfer is properly categorized
            if (!isPaymentTransfer) {
              isPaymentTransfer = true
              console.log(`Token ${tokenId}: SELL tx=${log.transactionHash}, tokens=${amount.toString()} (ETH amount calculation failed, but still marked as payment)`)
            }
          }
          
          if (!isPaymentTransfer) {
            console.log(`Token ${tokenId}: ${transferType} tx=${log.transactionHash}, from=${fromAddr}, to=${toAddr}, amount=${amount.toString()}`)
          }
        } catch (e) {
          // Transaction might not be available, continue without price
          console.warn(`Could not get transaction ${log.transactionHash} for price calculation:`, e)
        }

        // Check if this transfer should be skipped (DEX operation for graduated token)
        const { rows: dexCheck } = await client.query(
          `SELECT 1 FROM public.token_trades 
           WHERE chain_id = $1 AND block_number = $2 AND tx_hash = $3
           LIMIT 1`,
          [chainId, bn, log.transactionHash!]
        )
        
        if (dexCheck.length > 0) {
          console.log(`Skipping DEX transfer: token ${tokenId}, tx ${log.transactionHash} (exists in token_trades)`)
          continue // Skip this transfer as it's already in token_trades
        }

        await client.query(
          `INSERT INTO public.token_transfers
             (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side)
           VALUES ($1,$2,$3,$4, to_timestamp($5), $6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (chain_id, tx_hash, log_index) DO UPDATE SET
             amount_eth_wei = CASE WHEN EXCLUDED.amount_eth_wei IS NOT NULL THEN EXCLUDED.amount_eth_wei ELSE token_transfers.amount_eth_wei END,
             price_eth_per_token = CASE WHEN EXCLUDED.price_eth_per_token IS NOT NULL THEN EXCLUDED.price_eth_per_token ELSE token_transfers.price_eth_per_token END,
             side = EXCLUDED.side`,
          [tokenId, chainId, tokenAddr, bn, ts, log.transactionHash!, log.index!, fromAddr, toAddr, amount.toString(), isPaymentTransfer ? ethAmount.toString() : null, isPaymentTransfer ? price : null, transferType]
        )

        if (fromAddr !== ZERO) {
          await client.query(
            `INSERT INTO public.token_balances (token_id, chain_id, holder, balance_wei)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (token_id, holder) DO UPDATE
             SET balance_wei = token_balances.balance_wei - EXCLUDED.balance_wei`,
            [tokenId, chainId, fromAddr, amount.toString()]
          )
        }
        if (toAddr !== ZERO) {
          await client.query(
            `INSERT INTO public.token_balances (token_id, chain_id, holder, balance_wei)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (token_id, holder) DO UPDATE
             SET balance_wei = token_balances.balance_wei + EXCLUDED.balance_wei`,
            [tokenId, chainId, toAddr, amount.toString()]
          )
        }
      }

      // hygiene: delete exact zeros (only for touched tokens to keep it cheap)
      if (touchedTokenIds.size > 0) {
        await client.query(
          `DELETE FROM public.token_balances
           WHERE token_id = ANY($1::int[]) AND balance_wei::numeric = 0`,
          [Array.from(touchedTokenIds)]
        )
      }

      // recompute holders + bump per-token watermark only for touched tokens
      for (const tokenId of touchedTokenIds) {
        const { rows: [{ holders }] } = await client.query(
          `SELECT COUNT(*)::int AS holders
           FROM public.token_balances
           WHERE token_id = $1 AND balance_wei::numeric > 0`,
          [tokenId]
        )
        await client.query(
          `UPDATE public.tokens
           SET holder_count = $1,
               holder_count_updated_at = NOW(),
               last_processed_block = $2
           WHERE id = $3`,
          [holders, to, tokenId]
        )
      }

      // advance chain cursor regardless of whether there were logs
      await upsertChainCursor(chainId, to)

      await client.query('COMMIT')
      console.log(`Chain ${chainId}: +${allLogs.length} logs across ${touchedTokenIds.size} tokens → cursor=${to}`)
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }
}

// -------------------- Main --------------------
async function main() {
  // Optional visibility (no secrets)
  try {
    const u = new URL(process.env.DATABASE_URL!)
    console.log(`DB host: ${u.hostname}:${u.port || '5432'}`)
  } catch { /* ignore */ }

  const lock = await acquireGlobalLock()
  if (!lock) {
    console.log('Another worker run is in progress. Exiting.')
    await pool.end()
    return
  }

  try {
    const allTokens = await fetchTokens()
    if (allTokens.length === 0) {
      console.log('No tokens found with contract_address; exiting.')
      return
    }

    // Group tokens per chain
    const byChain = new Map<number, TokenRow[]>()
    for (const t of allTokens) {
      if (t.contract_address == null) continue
      if (!byChain.has(t.chain_id)) byChain.set(t.chain_id, [])
      byChain.get(t.chain_id)!.push(t)
    }

    let chainsToProcess = byChain

    if (!SKIP_HEALTH_CHECK) {
      console.log(`\n🔍 Checking chain health before processing...`)
      const healthyChains = await getHealthyChains(byChain)

      if (healthyChains.size === 0) {
        console.log('❌ No healthy chains found for ERC-20 scan. Skipping transfer scan, continuing with pools pipeline.')
        chainsToProcess = new Map<number, TokenRow[]>() // empty map; we'll still run pools later
      } else {
        console.log(`\n✅ ERC-20 scan on ${healthyChains.size} healthy chains (of ${byChain.size})`)
        chainsToProcess = healthyChains
      }
    } else {
      console.log(`\n⚠️  Health checks disabled - processing all ${byChain.size} chains for ERC-20 scan`)
    }

    // 1) Pools pipeline (auto-discovery + DEX logs) — run FIRST to populate token_trades
    for (const [chainId] of chainsToProcess) {
      console.log(`\n=== Pools pipeline: chain ${chainId} ===`)
      try {
        await runPoolsPipelineForChain(chainId)
      } catch (e) {
        console.error(`Chain ${chainId}: pools pipeline failed with`, e)
        // continue to next chain
      }
    }

    // 1.5) Clean up any overlapping records between token_transfers and token_trades
    for (const [chainId] of chainsToProcess) {
      console.log(`\n=== Cleanup overlapping transfers: chain ${chainId} ===`)
      try {
        await cleanupOverlappingTransfers(chainId)
      } catch (e) {
        console.error(`Chain ${chainId}: cleanup failed with`, e)
        // continue to next chain
      }
    }

    // 2) ERC-20 transfers/balances/holders — run AFTER pools to avoid DEX overlap
    for (const [chainId, tokens] of chainsToProcess) {
      console.log(`\n=== ERC-20 scan: chain ${chainId} (${tokens.length} tokens) ===`)
      try {
        const provider = providerFor(chainId)
        await processChain(chainId, tokens)
        await backfillTransferPrices(chainId, provider)
      } catch (e) {
        console.error(`Chain ${chainId}: ERC-20 scan failed with`, e)
        // continue to next chain
      }
    }

    // 3) Aggregations (candles, daily, token summaries) — run for ALL chains
    for (const chainId of byChain.keys()) {
      console.log(`\n=== Aggregations: chain ${chainId} ===`)
      try {
        await runAggPipelineForChain(chainId)
      } catch (e) {
        console.error(`Chain ${chainId}: agg pipeline failed with`, e)
        // continue to next chain
      }
    }

    
  } finally {
    await lock.release()
    await pool.end()
    console.log('\nDone. Exiting.')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})







