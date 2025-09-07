import 'dotenv/config'
import { ethers } from 'ethers'
import type { Log } from 'ethers'
import type { PoolClient } from 'pg'
import pool from '../lib/db'
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from '../lib/chains'

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)')
const ZERO = '0x0000000000000000000000000000000000000000'
const ONLY_TOKEN_ID = process.env.TOKEN_ID ? Number(process.env.TOKEN_ID) : undefined

// Tunables (env)
const DEFAULT_CHUNK = Number(process.env.WORKER_CHUNK ?? 50000) // blocks per query
const HEADER_SLEEP_MS = Number(process.env.WORKER_SLEEP_MS ?? 15) // ms pacing between getBlock calls
const REORG_CUSHION = Math.max(0, Number(process.env.REORG_CUSHION ?? 5)) // blocks to rewind
const BATCH_SIZE = Number(process.env.WORKER_BATCH_SIZE ?? 100) // tokens per batch per chain

// Global singleton lock (prevents overlapping runs)
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

function isRateLimit(err: unknown): boolean {
  const errorObj = err as {
    code?: number
    error?: { code?: number; message?: string }
    message?: string
  }
  const code = errorObj?.code ?? errorObj?.error?.code
  const msg = (errorObj?.message ?? errorObj?.error?.message ?? '').toLowerCase()
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

type TokenRow = {
  id: number
  chain_id: number
  contract_address: string | null
  created_at: string | null
  deployment_block: number | null
  last_processed_block: number | null
}

async function fetchTokens(): Promise<TokenRow[]> {
  const base = `
    SELECT id, chain_id, contract_address, created_at, deployment_block, last_processed_block
    FROM public.tokens
    WHERE contract_address IS NOT NULL
  `
  const sql = ONLY_TOKEN_ID ? base + ' AND id = $1' : base
  const params = ONLY_TOKEN_ID ? [ONLY_TOKEN_ID] : []
  const { rows } = await pool.query(sql, params)
  return rows
}

function addrFromTopic(topic: string): string {
  return ('0x' + topic.slice(26)).toLowerCase()
}

// Utility functions for batching
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

function groupBy<T, K extends string | number>(array: T[], keyFn: (item: T) => K): Record<K, T[]> {
  return array.reduce((groups, item) => {
    const key = keyFn(item)
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
    return groups
  }, {} as Record<K, T[]>)
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

// ---- Timestamp LRU cache (cap ~2000) ----
const tsCache = new Map<number, number>()
function cacheTs(bn: number, ts: number) {
  tsCache.set(bn, ts)
  if (tsCache.size > 2000) {
    const first = tsCache.keys().next().value as number | undefined
    if (first !== undefined) tsCache.delete(first)
  }
}

// Throttled header fetch with retries
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

// Process a batch of tokens on the same chain
async function processTokenBatch(chainId: number, tokens: TokenRow[]) {
  if (tokens.length === 0) return
  
  const provider = providerFor(chainId)
  const latest = await provider.getBlockNumber()
  
  // Find the common block range for this batch
  const validTokens = tokens.filter(t => t.contract_address)
  if (validTokens.length === 0) return
  
  // Calculate start block for each token and find the minimum
  const tokenStarts = new Map<number, number>()
  
  for (const token of validTokens) {
    let start = token.last_processed_block != null
      ? Math.max(token.last_processed_block - REORG_CUSHION, 0)
      : (token.deployment_block != null ? token.deployment_block : undefined)
    
    if (start == null) {
      const tsSec = token.created_at ? Math.floor(new Date(token.created_at).getTime() / 1000) : 0
      start = await findBlockByTimestamp(provider, tsSec)
      await pool.query(`UPDATE public.tokens SET deployment_block = $1 WHERE id = $2`, [start, token.id])
    }
    
    tokenStarts.set(token.id, start)
  }
  
  const minStart = Math.min(...Array.from(tokenStarts.values()))
  
  if (minStart > latest) {
    console.log(`Chain ${chainId}: all tokens up to date (min start ${minStart} > latest ${latest})`)
    return
  }
  
  // Process in chunks
  let chunk = DEFAULT_CHUNK
  for (let from = minStart; from <= latest; from += chunk + 1) {
    const to = Math.min(from + chunk, latest)
    console.log(`Chain ${chainId}: scanning blocks ${from}..${to} for ${validTokens.length} tokens`)
    
    let logs: Log[] = []
    try {
      logs = await provider.getLogs({
        address: validTokens.map(t => t.contract_address!),
        topics: [TRANSFER_TOPIC],
        fromBlock: from,
        toBlock: to,
      })
    } catch (e) {
      if (isRateLimit(e) && chunk > 5000) {
        chunk = Math.floor(chunk / 2)
        console.warn(`Rate limit on getLogs; shrinking chunk to ${chunk} and retrying`)
        from -= (chunk + 1) // retry same window
        continue
      }
      throw e
    }
    
    // Group logs by token address
    const logsByToken = new Map<string, Log[]>()
    for (const log of logs) {
      const address = log.address.toLowerCase()
      if (!logsByToken.has(address)) {
        logsByToken.set(address, [])
      }
      logsByToken.get(address)!.push(log)
    }
    
    // Get unique block numbers for timestamp fetching
    const blockNums = Array.from(new Set(logs.map(l => l.blockNumber!))).sort((a, b) => a - b)
    
    // Fetch timestamps
    let tsByBlock = new Map<number, number>()
    try {
      tsByBlock = await fetchBlockTimestamps(provider, blockNums)
    } catch (e) {
      if (isRateLimit(e)) {
        console.warn(`Rate limit on getBlock; using now() as fallback for this chunk`)
      } else {
        throw e
      }
    }
    
    // Process each token's logs
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      
      for (const token of validTokens) {
        const tokenLogs = logsByToken.get(token.contract_address!.toLowerCase()) || []
        if (tokenLogs.length === 0) continue
        
        // Only process logs that are within this token's range
        const tokenStart = tokenStarts.get(token.id)!
        const relevantLogs = tokenLogs.filter(log => log.blockNumber! >= tokenStart)
        
        for (const log of relevantLogs) {
          const fromAddr = addrFromTopic(log.topics[1])
          const toAddr = addrFromTopic(log.topics[2])
          const amount = BigInt(log.data)
          const bn = log.blockNumber!
          const ts = tsByBlock.get(bn) ?? Math.floor(Date.now() / 1000)
          
          await client.query(
            `INSERT INTO public.token_transfers
               (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei)
             VALUES ($1,$2,$3,$4, to_timestamp($5), $6,$7,$8,$9,$10)
             ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
            [token.id, token.chain_id, token.contract_address!, bn, ts, log.transactionHash!, log.index!, fromAddr, toAddr, amount.toString()]
          )
          
          if (fromAddr !== ZERO) {
            await client.query(
              `INSERT INTO public.token_balances (token_id, chain_id, holder, balance_wei)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (token_id, holder) DO UPDATE
               SET balance_wei = token_balances.balance_wei - EXCLUDED.balance_wei`,
              [token.id, token.chain_id, fromAddr, amount.toString()]
            )
          }
          if (toAddr !== ZERO) {
            await client.query(
              `INSERT INTO public.token_balances (token_id, chain_id, holder, balance_wei)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (token_id, holder) DO UPDATE
               SET balance_wei = token_balances.balance_wei + EXCLUDED.balance_wei`,
              [token.id, token.chain_id, toAddr, amount.toString()]
            )
          }
        }
        
        // Clean up zero balances and update holder count
        await client.query(
          `DELETE FROM public.token_balances
           WHERE token_id=$1 AND balance_wei::numeric = 0`,
          [token.id]
        )
        
        const { rows: [{ holders }] } = await client.query(
          `SELECT COUNT(*)::int AS holders
           FROM public.token_balances
           WHERE token_id = $1 AND balance_wei::numeric > 0`,
          [token.id]
        )
        
        await client.query(
          `UPDATE public.tokens
           SET holder_count = $1,
               holder_count_updated_at = NOW(),
               last_processed_block = $2
           WHERE id = $3`,
          [holders, to, token.id]
        )
        
        console.log(`Token ${token.id}: +${relevantLogs.length} logs → holders=${holders}, last_block=${to}`)
      }
      
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }
}

// Process all tokens on a specific chain
async function processChain(chainId: number, tokens: TokenRow[]) {
  if (tokens.length === 0) return
  
  console.log(`\n=== Processing chain ${chainId} with ${tokens.length} tokens ===`)
  
  // Split tokens into batches
  const batches = chunk(tokens, BATCH_SIZE)
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    console.log(`Chain ${chainId}: processing batch ${i + 1}/${batches.length} (${batch.length} tokens)`)
    
    try {
      await processTokenBatch(chainId, batch)
    } catch (e) {
      console.error(`Chain ${chainId} batch ${i + 1}: failed with`, e)
      // Continue with next batch instead of crashing the whole chain
    }
  }
}

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
    const tokens = await fetchTokens()
    if (tokens.length === 0) {
      console.log('No tokens found with contract_address; exiting.')
      return
    }

    console.log(`\n🚀 Starting optimized worker for ${tokens.length} tokens`)
    console.log(`📊 Batch size: ${BATCH_SIZE} tokens per batch per chain`)

    // Group tokens by chain ID
    const tokensByChain = groupBy(tokens, t => t.chain_id)
    const chainIds = Object.keys(tokensByChain).map(Number).sort()
    
    console.log(`🔗 Processing ${chainIds.length} chains: ${chainIds.join(', ')}`)
    
    // Process each chain (can be parallelized in the future)
    for (const chainId of chainIds) {
      const chainTokens = tokensByChain[chainId]
      console.log(`\n📈 Chain ${chainId}: ${chainTokens.length} tokens`)
      
      try {
        await processChain(chainId, chainTokens)
      } catch (e) {
        console.error(`Chain ${chainId}: failed with`, e)
        // Continue with next chain instead of crashing the whole run
      }
    }
    
    console.log('\n✅ Worker completed successfully. Exiting.')
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



