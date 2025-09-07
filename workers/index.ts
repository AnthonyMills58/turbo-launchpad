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

async function processToken(t: TokenRow) {
  if (!t.contract_address) return
  const provider = providerFor(t.chain_id)
  const latest = await provider.getBlockNumber()

  // Use reorg cushion when resuming
  let start =
    t.last_processed_block != null
      ? Math.max(t.last_processed_block - REORG_CUSHION, 0)
      : (t.deployment_block != null ? t.deployment_block : undefined)

  if (start == null) {
    const tsSec = t.created_at ? Math.floor(new Date(t.created_at).getTime() / 1000) : 0
    start = await findBlockByTimestamp(provider, tsSec)
    await pool.query(`UPDATE public.tokens SET deployment_block = $1 WHERE id = $2`, [start, t.id])
  }

  if (start > latest) {
    console.log(`Token ${t.id}: up to date (start ${start} > latest ${latest})`)
    return
  }

  let chunk = DEFAULT_CHUNK
  for (let from = start; from <= latest; from += chunk + 1) {
    const to = Math.min(from + chunk, latest)
    console.log(`Token ${t.id}: scanning blocks ${from}..${to}`)

    let logs: Log[] = []
    try {
      logs = await provider.getLogs({
        address: t.contract_address!,
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

    // unique block numbers for the logs (often small)
    const blockNums = Array.from(new Set(logs.map(l => l.blockNumber!))).sort((a, b) => a - b)

    // fetch timestamps with throttle + retry
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

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      for (const log of logs) {
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
          [t.id, t.chain_id, t.contract_address!, bn, ts, log.transactionHash!, log.index!, fromAddr, toAddr, amount.toString()]
        )

        if (fromAddr !== ZERO) {
          await client.query(
            `INSERT INTO public.token_balances (token_id, chain_id, holder, balance_wei)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (token_id, holder) DO UPDATE
             SET balance_wei = token_balances.balance_wei - EXCLUDED.balance_wei`,
            [t.id, t.chain_id, fromAddr, amount.toString()]
          )
        }
        if (toAddr !== ZERO) {
          await client.query(
            `INSERT INTO public.token_balances (token_id, chain_id, holder, balance_wei)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (token_id, holder) DO UPDATE
             SET balance_wei = token_balances.balance_wei + EXCLUDED.balance_wei`,
            [t.id, t.chain_id, toAddr, amount.toString()]
          )
        }
      }

      await client.query(
        `DELETE FROM public.token_balances
         WHERE token_id=$1 AND balance_wei::numeric = 0`,
        [t.id]
      )

      const { rows: [{ holders }] } = await client.query(
        `SELECT COUNT(*)::int AS holders
         FROM public.token_balances
         WHERE token_id = $1 AND balance_wei::numeric > 0`,
        [t.id]
      )

      await client.query(
        `UPDATE public.tokens
         SET holder_count = $1,
             holder_count_updated_at = NOW(),
             last_processed_block = $2
         WHERE id = $3`,
        [holders, to, t.id]
      )

      await client.query('COMMIT')
      console.log(`Token ${t.id}: +${logs.length} logs → holders=${holders}, last_block=${to}`)
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
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

    for (const t of tokens) {
      console.log(`\n=== Indexing token #${t.id} (chain ${t.chain_id}) ===`)
      try {
        await processToken(t)
      } catch (e) {
        console.error(`Token ${t.id}: failed with`, e)
        // continue to next token instead of crashing the whole run
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



