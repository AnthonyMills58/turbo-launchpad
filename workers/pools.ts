import { ethers, type Log } from 'ethers'
import pool from '../lib/db'
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from '../lib/chains'
import { DEX_ROUTER_BY_CHAIN, routerAbi, factoryAbi, pairAbi } from '../lib/dex'

// ---------- Config (same style as index.ts) ----------
const DEFAULT_DEX_CHUNK = Number(process.env.DEX_CHUNK ?? 5_000) // blocks per query window

// Event topics
const SWAP_TOPIC = ethers.id('Swap(address,uint256,uint256,uint256,uint256,address)')
const SYNC_TOPIC = ethers.id('Sync(uint112,uint112)')

// Reuse env RPCs like index.ts
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

// ---------- DB shapes ----------
type TokenRow = {
  id: number
  chain_id: number
  contract_address: string | null
}

type DexPoolRow = {
  token_id: number | null
  chain_id: number
  pair_address: string
  token0: string
  token1: string
  quote_token: string
  last_processed_block: number | null
  token_decimals: number | null
  quote_decimals: number | null
  deployment_block: number | null
}

// ---------- Helpers ----------
async function fetchTokensForChain(chainId: number): Promise<TokenRow[]> {
  const { rows } = await pool.query<TokenRow>(
    `SELECT id, chain_id, contract_address
     FROM public.tokens
     WHERE chain_id = $1 AND contract_address IS NOT NULL`,
    [chainId]
  )
  return rows
}

async function fetchDexPools(chainId: number): Promise<DexPoolRow[]> {
  const { rows } = await pool.query<DexPoolRow>(
    `SELECT dp.token_id, dp.chain_id, dp.pair_address, dp.token0, dp.token1, dp.quote_token,
            COALESCE(dp.last_processed_block,0) AS last_processed_block,
            dp.token_decimals, dp.quote_decimals,
            t.deployment_block
     FROM public.dex_pools dp
     JOIN public.tokens t ON dp.token_id = t.id
     WHERE dp.chain_id = $1
     ORDER BY dp.pair_address`,
    [chainId]
  )
  return rows
}

async function ensurePoolDecimals(p: DexPoolRow, provider: ethers.JsonRpcProvider) {
  if (p.token_decimals != null && p.quote_decimals != null) return p

  const decAbi = ['function decimals() view returns (uint8)']
  const t0 = new ethers.Contract(p.token0, decAbi, provider)
  const t1 = new ethers.Contract(p.token1, decAbi, provider)
  const [dec0, dec1] = await Promise.all([
    t0.decimals().catch(() => 18),
    t1.decimals().catch(() => 18),
  ])

  const isQuoteToken0 = p.quote_token.toLowerCase() === p.token0.toLowerCase()
  const quote_decimals = Number(isQuoteToken0 ? dec0 : dec1)
  const token_decimals = Number(isQuoteToken0 ? dec1 : dec0)

  await pool.query(
    `UPDATE public.dex_pools
     SET token_decimals = $1, quote_decimals = $2
     WHERE chain_id = $3 AND pair_address = $4`,
    [token_decimals, quote_decimals, p.chain_id, p.pair_address]
  )

  return { ...p, token_decimals, quote_decimals }
}

// ---------- 1) Auto-discover pools (detect new graduations) ----------
export async function discoverDexPools(chainId: number): Promise<void> {
  const routerAddr = DEX_ROUTER_BY_CHAIN[chainId]
  if (!routerAddr) {
    console.warn(`Chain ${chainId}: no router in DEX_ROUTER_BY_CHAIN; skipping discovery`)
    return
  }

  const provider = providerFor(chainId)
  const router = new ethers.Contract(routerAddr, routerAbi, provider)

  // Resolve factory + WETH once via router
  const factoryAddr: string = await router.factory()
  // Your routerAbi declares WETH() pure; still call it normally
  const wethAddr: string = await router.WETH()

  // Cache existing pool addresses to skip duplicates
  const existing = new Set<string>()
  {
    const { rows } = await pool.query<{ pair_address: string }>(
      `SELECT pair_address FROM public.dex_pools WHERE chain_id = $1`,
      [chainId]
    )
    for (const r of rows) existing.add(r.pair_address.toLowerCase())
  }

  const factory = new ethers.Contract(factoryAddr, factoryAbi, provider)
  const tokens = await fetchTokensForChain(chainId)

  for (const t of tokens) {
    if (!t.contract_address) continue
    const token = t.contract_address

    let pair: string = await factory.getPair(token, wethAddr).catch(() => ethers.ZeroAddress)
    if (!pair || pair === ethers.ZeroAddress) {
      pair = await factory.getPair(wethAddr, token).catch(() => ethers.ZeroAddress)
    }
    if (!pair || pair === ethers.ZeroAddress) continue // not graduated / no LP yet

    const pairLc = pair.toLowerCase()
    if (existing.has(pairLc)) continue // already known

    // Read token0/token1 ordering
    const pairCtr = new ethers.Contract(pair, pairAbi, provider)
    const [token0, token1] = await Promise.all([pairCtr.token0(), pairCtr.token1()])

    await pool.query(
      `INSERT INTO public.dex_pools
         (token_id, chain_id, pair_address, token0, token1, quote_token)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (chain_id, pair_address) DO NOTHING`,
      [t.id, chainId, pair, token0, token1, wethAddr]
    )

    // Optional: reflect on_dex flag and graduation status
    await pool.query(
      `UPDATE public.tokens
       SET on_dex = TRUE, is_graduated = TRUE, updated_at = NOW()
       WHERE id = $1 AND (on_dex IS DISTINCT FROM TRUE)`,
      [t.id]
    )

    console.log(`🧭 Discovered pool for token ${t.id} on chain ${chainId}: ${pair}`)
  }
}

// ---------- 2) Scan pools → pair_snapshots + token_trades ----------
// Backfill trader addresses in existing token_trades records
export async function backfillTraderAddresses(chainId: number): Promise<void> {
  console.log(`\n=== Backfilling trader addresses for chain ${chainId} ===`)
  
  // Get the router address for this chain
  const routerAddress = DEX_ROUTER_BY_CHAIN[chainId]
  if (!routerAddress) {
    console.log(`No router address configured for chain ${chainId}, skipping trader backfill`)
    return
  }
  
  // First, let's see what trader addresses we actually have
  const { rows: allTraders } = await pool.query(
    `SELECT DISTINCT trader, COUNT(*) as count
     FROM public.token_trades 
     WHERE chain_id = $1 AND src = 'DEX'
     GROUP BY trader
     ORDER BY count DESC`,
    [chainId]
  )
  
  console.log(`Current trader addresses in token_trades for chain ${chainId}:`)
  for (const row of allTraders) {
    console.log(`  ${row.trader}: ${row.count} trades`)
  }
  
  console.log(`Looking for router address: ${routerAddress}`)
  
  // Get all token_trades records that have the router address as trader (case insensitive)
  const { rows: tradesToFix } = await pool.query(
    `SELECT token_id, tx_hash, log_index, trader
     FROM public.token_trades 
     WHERE chain_id = $1 AND src = 'DEX' AND LOWER(trader) = LOWER($2)`,
    [chainId, routerAddress]
  )
  
  if (tradesToFix.length === 0) {
    console.log(`No token_trades records need trader address backfill for chain ${chainId}`)
    return
  }
  
  console.log(`Found ${tradesToFix.length} token_trades records to backfill`)
  
  const provider = providerFor(chainId)
  let updatedCount = 0
  
  for (const trade of tradesToFix) {
    try {
      // Get the transaction to find the actual Swap event
      const tx = await provider.getTransaction(trade.tx_hash)
      if (!tx) continue
      
      const receipt = await provider.getTransactionReceipt(trade.tx_hash)
      if (!receipt) continue
      
      // Find the Swap event log that matches our log_index
      const swapLog = receipt.logs.find(log => 
        log.index === trade.log_index && 
        log.topics[0] === SWAP_TOPIC
      )
      
      if (swapLog) {
        // Extract the correct trader address (to address from Swap event)
        const correctTrader = ethers.getAddress('0x' + swapLog.topics[2].slice(26))
        
        // Update the record using composite key
        await pool.query(
          `UPDATE public.token_trades 
           SET trader = $1 
           WHERE chain_id = $2 AND tx_hash = $3 AND log_index = $4`,
          [correctTrader, chainId, trade.tx_hash, trade.log_index]
        )
        
        updatedCount++
        console.log(`Updated trade ${trade.tx_hash}:${trade.log_index}: ${trade.trader} -> ${correctTrader}`)
      }
    } catch (error) {
      console.warn(`Failed to backfill trader for trade ${trade.tx_hash}:${trade.log_index}:`, error)
    }
  }
  
  console.log(`Backfilled trader addresses for ${updatedCount}/${tradesToFix.length} records`)
}

export async function processDexPools(chainId: number): Promise<void> {
  const provider = providerFor(chainId)
  const pools = await fetchDexPools(chainId)
  if (pools.length === 0) return

  const head = await provider.getBlockNumber()

  for (const rawPool of pools) {
    const p = await ensurePoolDecimals(rawPool, provider)
    // For pools without snapshots, start from deployment block (graduation block)
    // For pools with snapshots, continue from last processed block
    const { rows: hasSnapshots } = await pool.query(
      `SELECT 1 FROM public.pair_snapshots WHERE chain_id = $1 AND pair_address = $2 LIMIT 1`,
      [p.chain_id, p.pair_address]
    )
    
    let from: number
    if (hasSnapshots.length === 0) {
      // No snapshots: start from actual graduation block (from GRADUATION record in token_transfers)
      // If no graduation record found, fall back to deployment_block or head - 50000
      const { rows: graduationRows } = await pool.query(
        `SELECT block_number FROM public.token_transfers 
         WHERE chain_id = $1 AND token_id = $2 AND side = 'GRADUATION' 
         ORDER BY block_number ASC LIMIT 1`,
        [p.chain_id, p.token_id]
      )
      
      const graduationBlock = graduationRows[0]?.block_number ?? p.deployment_block ?? Math.max(1, head - 50000)
      from = Math.max(1, graduationBlock)
      console.log(`Pool ${p.pair_address}: no snapshots found, starting from graduation block ${graduationBlock}`)
    } else {
      // Has snapshots: continue from last processed block + 1
      from = Math.max(1, (p.last_processed_block ?? 0) + 1)
    }
    
    if (from > head) continue
    const to = Math.min(head, from + DEFAULT_DEX_CHUNK)
    
    console.log(`Pool ${p.pair_address}: last_processed=${p.last_processed_block}, deployment=${p.deployment_block}, from=${from}, to=${to}`)

    const logs: Log[] = await provider.getLogs({
      address: p.pair_address as `0x${string}`,
      fromBlock: from,
      toBlock: to,
      topics: [[SWAP_TOPIC, SYNC_TOPIC]],
    })

    logs.sort(
      (a, b) =>
        a.blockNumber - b.blockNumber ||
        a.transactionIndex - b.transactionIndex ||
        a.index - b.index
    )

    const isQuoteToken0 = p.quote_token.toLowerCase() === p.token0.toLowerCase()

    // simple per-chunk timestamp cache
    const blkTs = new Map<number, number>()
    const tsOf = async (bn: number) => {
      if (blkTs.has(bn)) return blkTs.get(bn)!
      const blk = await provider.getBlock(bn)
      const ts = Number(blk?.timestamp ?? Math.floor(Date.now() / 1000))
      blkTs.set(bn, ts)
      return ts
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      for (const log of logs) {
        const bn = log.blockNumber!
        const block_time = new Date((await tsOf(bn)) * 1000)

        if (log.topics[0] === SYNC_TOPIC) {
          const [r0, r1] = ethers.AbiCoder.defaultAbiCoder().decode(['uint112','uint112'], log.data)
          const reserve0 = BigInt(r0.toString())
          const reserve1 = BigInt(r1.toString())

          const reserveQuoteWei = isQuoteToken0 ? reserve0 : reserve1
          const reserveTokenWei = isQuoteToken0 ? reserve1 : reserve0

          const price_eth_per_token =
            (Number(reserveQuoteWei) / 10 ** (p.quote_decimals ?? 18)) /
            (Number(reserveTokenWei) / 10 ** (p.token_decimals ?? 18))

          await client.query(
            `INSERT INTO public.pair_snapshots
               (chain_id, pair_address, block_number, block_time,
                reserve0_wei, reserve1_wei, price_eth_per_token)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (chain_id, pair_address, block_number)
             DO UPDATE SET
               block_time = EXCLUDED.block_time,
               reserve0_wei = EXCLUDED.reserve0_wei,
               reserve1_wei = EXCLUDED.reserve1_wei,
               price_eth_per_token = EXCLUDED.price_eth_per_token`,
            [
              p.chain_id, p.pair_address, bn, block_time,
              reserve0.toString(), reserve1.toString(), price_eth_per_token
            ]
          )
        } else if (log.topics[0] === SWAP_TOPIC) {
          const to = ethers.getAddress('0x' + log.topics[2].slice(26))
          const [a0In, a1In, a0Out, a1Out] =
            ethers.AbiCoder.defaultAbiCoder().decode(['uint256','uint256','uint256','uint256'], log.data)

          const n0In  = BigInt(a0In.toString())
          const n1In  = BigInt(a1In.toString())
          const n0Out = BigInt(a0Out.toString())
          const n1Out = BigInt(a1Out.toString())

          let side: 'BUY' | 'SELL'
          let tokenWei: bigint
          let quoteWei: bigint

          if (isQuoteToken0) {
            // quote = token0, token = token1
            if (n1Out > 0n && n0In > 0n) { side = 'BUY';  tokenWei = n1Out; quoteWei = n0In }
            else                          { side = 'SELL'; tokenWei = n1In;  quoteWei = n0Out }
          } else {
            // quote = token1, token = token0
            if (n0Out > 0n && n1In > 0n) { side = 'BUY';  tokenWei = n0Out; quoteWei = n1In }
            else                          { side = 'SELL'; tokenWei = n0In;  quoteWei = n1Out }
          }

          const price_eth_per_token =
            (Number(quoteWei) / 10 ** (p.quote_decimals ?? 18)) /
            (Number(tokenWei) / 10 ** (p.token_decimals ?? 18))

          await client.query(
            `INSERT INTO public.token_trades
               (token_id, chain_id, src, tx_hash, log_index,
                block_number, block_time, side, trader,
                amount_token_wei, amount_eth_wei, price_eth_per_token)
             VALUES ($1,$2,'DEX',$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT DO NOTHING`,
            [
              p.token_id, p.chain_id,
              log.transactionHash!, log.index!,
              bn, block_time, side, to,
              tokenWei.toString(), quoteWei.toString(), price_eth_per_token
            ]
          )
        }
      }

      // Always update cursor when we successfully process a block range
      // (even if no events found, we still processed those blocks)
      await client.query(
        `UPDATE public.dex_pools
         SET last_processed_block = $1
         WHERE chain_id = $2 AND pair_address = $3`,
        [to, p.chain_id, p.pair_address]
      )

      await client.query('COMMIT')
      console.log(`DEX ${chainId} ${p.pair_address}: logs=${logs.length} cursor=${to}`)
    } catch (e) {
      await client.query('ROLLBACK')
      console.error(`DEX ${chainId} ${p.pair_address} failed:`, e)
    } finally {
      client.release()
    }
  }
}

// ---------- 3) Convenience: one-shot pipeline per chain ----------
export async function runPoolsPipelineForChain(chainId: number): Promise<void> {
  try {
    await discoverDexPools(chainId)  // auto-add pools after graduation
    await processDexPools(chainId)   // fill pair_snapshots + token_trades
    await backfillTraderAddresses(chainId)  // fix historical trader addresses
  } catch (e) {
    console.error(`Pools pipeline error on chain ${chainId}:`, e)
  }
}
