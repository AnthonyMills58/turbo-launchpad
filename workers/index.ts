import 'dotenv/config'
import { ethers } from 'ethers'
import type { Log } from 'ethers'
import type { PoolClient } from 'pg'
import pool from '../lib/db'
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from '../lib/chains'

// -------------------- Config --------------------
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)')
const ZERO = '0x0000000000000000000000000000000000000000'

// Optional: limit to one token for smoke tests (NOT used in chain-batched mode)
const ONLY_TOKEN_ID = process.env.TOKEN_ID ? Number(process.env.TOKEN_ID) : undefined

// Tunables
const DEFAULT_CHUNK = Number(process.env.WORKER_CHUNK ?? 50000)         // blocks per query
const HEADER_SLEEP_MS = Number(process.env.WORKER_SLEEP_MS ?? 15)       // ms between getBlock calls
const REORG_CUSHION = Math.max(0, Number(process.env.REORG_CUSHION ?? 5))
const ADDR_BATCH_LIMIT = Math.max(1, Number(process.env.ADDR_BATCH_LIMIT ?? 50)) // addresses per getLogs (reduced for stability)
const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS ?? 30000)      // RPC timeout in milliseconds
const MIN_CHUNK_SIZE = Number(process.env.MIN_CHUNK_SIZE ?? 100)        // minimum chunk size for safety
const EMERGENCY_CHUNK_SIZE = Number(process.env.EMERGENCY_CHUNK_SIZE ?? 10) // emergency fallback chunk size

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
}

type ChainCursorRow = {
  chain_id: number
  last_processed_block: number
}

// -------------------- DB helpers --------------------
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

// Dynamic chunk sizing based on address count to prevent timeouts
function getOptimalChunkSize(addressCount: number): number {
  if (addressCount <= 10) return Math.floor(DEFAULT_CHUNK * 0.1)  // 5k blocks for safety
  if (addressCount <= 50) return Math.floor(DEFAULT_CHUNK * 0.05) // 2.5k blocks
  if (addressCount <= 100) return Math.floor(DEFAULT_CHUNK * 0.02) // 1k blocks
  if (addressCount <= 200) return Math.floor(DEFAULT_CHUNK * 0.01) // 500 blocks
  return Math.max(MIN_CHUNK_SIZE, Math.floor(DEFAULT_CHUNK * 0.005)) // 250 blocks or min
}

// Progressive chunk shrinking for high-activity blocks
function getNextChunkSize(currentChunk: number, attempt: number): number {
  if (attempt >= 6) {
    // After 6 attempts, use emergency chunk size
    return EMERGENCY_CHUNK_SIZE
  }
  const shrinkFactor = Math.pow(0.5, attempt) // 0.5, 0.25, 0.125, etc.
  const newChunk = Math.floor(currentChunk * shrinkFactor)
  return Math.max(newChunk, MIN_CHUNK_SIZE)
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
  
  // Use dynamic chunk sizing based on address count
  let chunk = getOptimalChunkSize(addresses.length)
  console.log(`Chain ${chainId}: using chunk size ${chunk} for ${addresses.length} addresses (${addrBatches.length} batches)`)

  for (let from = start; from <= latest; from += chunk + 1) {
    const to = Math.min(from + chunk, latest)
    console.log(`Chain ${chainId}: scanning blocks ${from}..${to} across ${addresses.length} addresses`)

    // Collect logs across address batches with progressive retry
    let allLogs: Log[] = []
    let retryAttempt = 0
    const maxRetries = 8 // Allow up to 8 retries with shrinking chunks
    
    while (retryAttempt <= maxRetries) {
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
          
          // Small delay between batches to be nice to RPC
          if (addrBatches.length > 1) {
            await sleep(50)
          }
        }
        break // Success, exit retry loop
      } catch (e) {
        const error = e as { code?: string; message?: string }
        const isTimeout = error?.code === 'TIMEOUT' || 
                         error?.message?.includes('timeout') ||
                         error?.message?.includes('deadline exceeded')
        
        if ((isRateLimit(e) || isTimeout) && retryAttempt < maxRetries) {
          retryAttempt++
          chunk = getNextChunkSize(chunk, retryAttempt)
          
          // If we're down to emergency chunk size and still failing, try single blocks
          if (chunk === EMERGENCY_CHUNK_SIZE && retryAttempt >= 6) {
            console.warn(`Chain ${chainId}: Emergency chunk size failed, trying single-block processing for blocks ${from}..${to}`)
            // Process one block at a time
            for (let singleBlock = from; singleBlock <= to; singleBlock++) {
              try {
                for (const batch of addrBatches) {
                  const singleLogs = await provider.getLogs({
                    address: batch as unknown as string[],
                    topics: [TRANSFER_TOPIC],
                    fromBlock: singleBlock,
                    toBlock: singleBlock,
                  })
                  allLogs = allLogs.concat(singleLogs)
                  await sleep(100) // Small delay between single blocks
                }
              } catch (singleError) {
                console.error(`Chain ${chainId}: Failed to process single block ${singleBlock}, skipping:`, singleError)
                // Continue with next block instead of failing completely
              }
            }
            break // Exit retry loop after single-block processing
          }
          
          console.warn(`${isTimeout ? 'Timeout' : 'Rate limit'} on getLogs(chain ${chainId}) attempt ${retryAttempt}; shrinking chunk to ${chunk} and retrying`)
          
          // Reset logs for retry
          allLogs = []
          await sleep(1000 * retryAttempt) // Progressive backoff
          continue
        }
        throw e
      }
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

        await client.query(
          `INSERT INTO public.token_transfers
             (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei)
           VALUES ($1,$2,$3,$4, to_timestamp($5), $6,$7,$8,$9,$10)
           ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
          [tokenId, chainId, tokenAddr, bn, ts, log.transactionHash!, log.index!, fromAddr, toAddr, amount.toString()]
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
      console.log(`Chain ${chainId}: +${allLogs.length} logs across ${touchedTokenIds.size} tokens → cursor=${to} (chunk: ${chunk})`)
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
    console.log(`\n🚀 Starting optimized worker with configuration:`)
    console.log(`📊 Default chunk: ${DEFAULT_CHUNK} blocks`)
    console.log(`🔗 Address batch limit: ${ADDR_BATCH_LIMIT} addresses per RPC call`)
    console.log(`⏱️  RPC timeout: ${RPC_TIMEOUT_MS}ms`)
    console.log(`🛡️  Reorg cushion: ${REORG_CUSHION} blocks`)
    console.log(`📏 Min chunk size: ${MIN_CHUNK_SIZE} blocks`)

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

    for (const [chainId, tokens] of byChain) {
      console.log(`\n=== Indexing chain ${chainId} (${tokens.length} tokens) ===`)
      try {
        await processChain(chainId, tokens)
      } catch (e) {
        console.error(`Chain ${chainId}: failed with`, e)
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




