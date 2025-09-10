import { ethers, type Log } from 'ethers'
import pool from '../lib/db'
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from '../lib/chains'
import { DEX_ROUTER_BY_CHAIN, routerAbi, factoryAbi, pairAbi } from '../lib/dex'
import TurboTokenABI from '../lib/abi/TurboToken.json'

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
      [t.id, chainId, pair.toLowerCase(), token0.toLowerCase(), token1.toLowerCase(), wethAddr.toLowerCase()]
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
  
  // First, clean up any reverted transactions from existing records
  const providerForCleanup = providerFor(chainId)
  const { rows: allTrades } = await pool.query(
    `SELECT tx_hash FROM public.token_trades WHERE chain_id = $1 AND src = 'DEX'`,
    [chainId]
  )
  
  let revertedCount = 0
  for (const trade of allTrades) {
    try {
      const receipt = await providerForCleanup.getTransactionReceipt(trade.tx_hash)
      if (receipt && receipt.status !== 1) {
        await pool.query(
          `DELETE FROM public.token_trades WHERE chain_id = $1 AND tx_hash = $2`,
          [chainId, trade.tx_hash]
        )
        revertedCount++
        console.log(`Removed reverted transaction: ${trade.tx_hash}`)
      }
    } catch (error) {
      console.warn(`Failed to check transaction status for ${trade.tx_hash}:`, error)
    }
  }
  
  if (revertedCount > 0) {
    console.log(`Cleaned up ${revertedCount} reverted transactions`)
  }
  
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
        // The real trader is the transaction sender, not the 'to' address in Swap event
        // For both BUY and SELL operations, the transaction sender is the actual trader
        const correctTrader = tx.from
        
        // Update the record using composite key (normalize to lowercase)
        await pool.query(
          `UPDATE public.token_trades 
           SET trader = $1 
           WHERE chain_id = $2 AND tx_hash = $3 AND log_index = $4`,
          [correctTrader.toLowerCase(), chainId, trade.tx_hash, trade.log_index]
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
    const touchedTokenIds = new Set<number>()
    
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
          // Get the actual trader from the transaction sender, not the Swap event 'to' address
          const tx = await provider.getTransaction(log.transactionHash!)
          const actualTrader = tx?.from || ethers.getAddress('0x' + log.topics[2].slice(26))
          
          // Check if transaction was successful (not reverted)
          const receipt = await provider.getTransactionReceipt(log.transactionHash!)
          if (receipt && receipt.status !== 1) {
            console.log(`Skipping reverted transaction: ${log.transactionHash}`)
            continue
          }
          
          
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
          
          // Debug: Log suspicious cases where amounts are equal
          if (tokenWei === quoteWei) {
            console.log(`SUSPICIOUS: tokenWei === quoteWei for tx ${log.transactionHash}`)
            console.log(`  isQuoteToken0: ${isQuoteToken0}`)
            console.log(`  n0In: ${n0In}, n1In: ${n1In}, n0Out: ${n0Out}, n1Out: ${n1Out}`)
            console.log(`  side: ${side}, tokenWei: ${tokenWei}, quoteWei: ${quoteWei}`)
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
             ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
            [
              p.token_id, p.chain_id,
              log.transactionHash!, log.index!,
              bn, block_time, side, actualTrader.toLowerCase(),
              tokenWei.toString(), quoteWei.toString(), price_eth_per_token
            ]
          )
          
          // Update token balances for DEX trades using current blockchain balance
          if (p.token_id) {
            try {
              // Get token contract address from tokens table
              const { rows: [tokenRow] } = await client.query(
                `SELECT contract_address FROM public.tokens WHERE id = $1`,
                [p.token_id]
              )
              
              if (tokenRow?.contract_address) {
                const contract = new ethers.Contract(tokenRow.contract_address, TurboTokenABI.abi, provider)
                const currentBalanceWei = await contract.balanceOf(actualTrader)
                
                if (currentBalanceWei > 0n) {
                  await client.query(
                    `INSERT INTO public.token_balances (token_id, chain_id, holder, balance_wei)
                     VALUES ($1,$2,$3,$4)
                     ON CONFLICT (token_id, holder) DO UPDATE
                     SET balance_wei = EXCLUDED.balance_wei`,
                    [p.token_id, p.chain_id, actualTrader.toLowerCase(), currentBalanceWei.toString()]
                  )
                } else {
                  // Remove zero balance
                  await client.query(
                    `DELETE FROM public.token_balances 
                     WHERE token_id = $1 AND holder = $2`,
                    [p.token_id, actualTrader.toLowerCase()]
                  )
                }
                touchedTokenIds.add(p.token_id)
              }
            } catch (error) {
              console.warn(`Failed to get current balance for trader ${actualTrader} on token ${p.token_id}:`, error)
            }
          }
        }
      }

      // Clean up zero balances for tokens that had DEX trades
      if (touchedTokenIds.size > 0) {
        await client.query(
          `DELETE FROM public.token_balances
           WHERE token_id = ANY($1::int[]) AND balance_wei::numeric = 0`,
          [Array.from(touchedTokenIds)]
        )
        
        // Update holder counts for tokens that had DEX trades
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
                 holder_count_updated_at = NOW()
             WHERE id = $2`,
            [holders, tokenId]
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

async function normalizeAllAddresses(chainId: number): Promise<void> {
  console.log(`=== Normalizing all addresses to lowercase for chain ${chainId} ===`)
  
  // Normalize token_trades.trader
  const { rowCount: tradesUpdated } = await pool.query(
    `UPDATE public.token_trades 
     SET trader = LOWER(trader) 
     WHERE chain_id = $1 AND trader != LOWER(trader)`,
    [chainId]
  )
  if (tradesUpdated && tradesUpdated > 0) {
    console.log(`Normalized ${tradesUpdated} trader addresses in token_trades`)
  }
  
  // Normalize token_transfers.from_address and to_address
  const { rowCount: transfersFromUpdated } = await pool.query(
    `UPDATE public.token_transfers 
     SET from_address = LOWER(from_address) 
     WHERE chain_id = $1 AND from_address != LOWER(from_address)`,
    [chainId]
  )
  const { rowCount: transfersToUpdated } = await pool.query(
    `UPDATE public.token_transfers 
     SET to_address = LOWER(to_address) 
     WHERE chain_id = $1 AND to_address != LOWER(to_address)`,
    [chainId]
  )
  if ((transfersFromUpdated && transfersFromUpdated > 0) || (transfersToUpdated && transfersToUpdated > 0)) {
    console.log(`Normalized ${transfersFromUpdated || 0} from_address and ${transfersToUpdated || 0} to_address in token_transfers`)
  }
  
  // Normalize token_balances.holder (handle duplicates by merging)
  const { rows: balanceDuplicates } = await pool.query(
    `SELECT token_id, LOWER(holder) as holder_lower, 
            COUNT(*) as count, 
            STRING_AGG(holder, ',') as addresses,
            SUM(balance_wei::numeric) as total_balance
     FROM public.token_balances 
     WHERE chain_id = $1
     GROUP BY token_id, LOWER(holder)
     HAVING COUNT(*) > 1`,
    [chainId]
  )
  
  for (const dup of balanceDuplicates) {
    console.log(`Removing ${dup.count} duplicate holder records for ${dup.holder_lower} on token ${dup.token_id}`)
    
    // Delete all duplicate records - we'll let the backfill function get the correct balance from blockchain
    await pool.query(
      `DELETE FROM public.token_balances 
       WHERE chain_id = $1 AND token_id = $2 AND LOWER(holder) = $3`,
      [chainId, dup.token_id, dup.holder_lower]
    )
    
    console.log(`Deleted duplicate records - correct balance will be fetched from blockchain`)
  }
  
  // Now normalize remaining addresses
  const { rowCount: balancesUpdated } = await pool.query(
    `UPDATE public.token_balances 
     SET holder = LOWER(holder) 
     WHERE chain_id = $1 AND holder != LOWER(holder)`,
    [chainId]
  )
  if (balancesUpdated && balancesUpdated > 0) {
    console.log(`Normalized ${balancesUpdated} holder addresses in token_balances`)
  }
  
  // Normalize tokens.creator_wallet
  const { rowCount: tokensUpdated } = await pool.query(
    `UPDATE public.tokens 
     SET creator_wallet = LOWER(creator_wallet) 
     WHERE chain_id = $1 AND creator_wallet != LOWER(creator_wallet)`,
    [chainId]
  )
  if (tokensUpdated && tokensUpdated > 0) {
    console.log(`Normalized ${tokensUpdated} creator_wallet addresses in tokens`)
  }
  
  // Normalize dex_pools.pair_address
  const { rowCount: poolsUpdated } = await pool.query(
    `UPDATE public.dex_pools 
     SET pair_address = LOWER(pair_address) 
     WHERE chain_id = $1 AND pair_address != LOWER(pair_address)`,
    [chainId]
  )
  if (poolsUpdated && poolsUpdated > 0) {
    console.log(`Normalized ${poolsUpdated} pair_address in dex_pools`)
  }
  
  // Normalize dex_pools.token0, token1, quote_token
  const { rowCount: poolsToken0Updated } = await pool.query(
    `UPDATE public.dex_pools 
     SET token0 = LOWER(token0) 
     WHERE chain_id = $1 AND token0 != LOWER(token0)`,
    [chainId]
  )
  const { rowCount: poolsToken1Updated } = await pool.query(
    `UPDATE public.dex_pools 
     SET token1 = LOWER(token1) 
     WHERE chain_id = $1 AND token1 != LOWER(token1)`,
    [chainId]
  )
  const { rowCount: poolsQuoteUpdated } = await pool.query(
    `UPDATE public.dex_pools 
     SET quote_token = LOWER(quote_token) 
     WHERE chain_id = $1 AND quote_token != LOWER(quote_token)`,
    [chainId]
  )
  if ((poolsToken0Updated && poolsToken0Updated > 0) || (poolsToken1Updated && poolsToken1Updated > 0) || (poolsQuoteUpdated && poolsQuoteUpdated > 0)) {
    console.log(`Normalized ${poolsToken0Updated || 0} token0, ${poolsToken1Updated || 0} token1, ${poolsQuoteUpdated || 0} quote_token in dex_pools`)
  }
  
  console.log(`Address normalization completed for chain ${chainId}`)
}

async function normalizeAppWideAddresses(): Promise<void> {
  console.log(`=== Normalizing app-wide addresses to lowercase ===`)
  
  // Normalize media_assets.owner_wallet (if table exists)
  try {
    const { rowCount: mediaUpdated } = await pool.query(
      `UPDATE public.media_assets 
       SET owner_wallet = LOWER(owner_wallet) 
       WHERE owner_wallet != LOWER(owner_wallet)`
    )
    if (mediaUpdated && mediaUpdated > 0) {
      console.log(`Normalized ${mediaUpdated} owner_wallet addresses in media_assets`)
    }
  } catch {
    console.log(`Skipping media_assets normalization: table may not exist`)
  }
  
  // Normalize profiles.wallet (if table exists)
  try {
    const { rowCount: profilesUpdated } = await pool.query(
      `UPDATE public.profiles 
       SET wallet = LOWER(wallet) 
       WHERE wallet != LOWER(wallet)`
    )
    if (profilesUpdated && profilesUpdated > 0) {
      console.log(`Normalized ${profilesUpdated} wallet addresses in profiles`)
    }
  } catch {
    console.log(`Skipping profiles normalization: table may not exist`)
  }
  
  console.log(`App-wide address normalization completed`)
}

async function backfillDexBalances(chainId: number): Promise<void> {
  console.log(`=== Backfilling DEX balances for chain ${chainId} ===`)
  
  // Get all unique traders from DEX trades
  const { rows: traders } = await pool.query(
    `SELECT DISTINCT trader FROM public.token_trades 
     WHERE chain_id = $1 AND src = 'DEX' AND trader IS NOT NULL`,
    [chainId]
  )
  
  if (traders.length === 0) {
    console.log(`No DEX traders found for chain ${chainId}`)
    return
  }
  
  console.log(`Found ${traders.length} unique DEX traders to backfill balances for`)
  
  // Get all tokens that have DEX trades
  const { rows: tokens } = await pool.query(
    `SELECT DISTINCT t.id, t.contract_address 
     FROM public.tokens t
     JOIN public.token_trades tr ON tr.token_id = t.id
     WHERE t.chain_id = $1 AND tr.src = 'DEX'`,
    [chainId]
  )
  
  if (tokens.length === 0) {
    console.log(`No tokens with DEX trades found for chain ${chainId}`)
    return
  }
  
  const provider = providerFor(chainId)
  let updatedBalances = 0
  
  // For each token, get current balance for each trader using ethers
  for (const token of tokens) {
    try {
      const contract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, provider)
      
      for (const trader of traders) {
        try {
          // Get current balance from blockchain
          const balanceWei = await contract.balanceOf(trader.trader)
          
          if (balanceWei > 0n) {
            // Update or insert balance
            await pool.query(
              `INSERT INTO public.token_balances (token_id, chain_id, holder, balance_wei)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (token_id, holder) DO UPDATE
               SET balance_wei = EXCLUDED.balance_wei`,
              [token.id, chainId, trader.trader.toLowerCase(), balanceWei.toString()]
            )
            updatedBalances++
          } else {
            // Remove zero balance
            await pool.query(
              `DELETE FROM public.token_balances 
               WHERE token_id = $1 AND holder = $2`,
              [token.id, trader.trader.toLowerCase()]
            )
          }
        } catch (error) {
          console.warn(`Failed to get balance for trader ${trader.trader} on token ${token.id}:`, error)
        }
      }
      
      // Update holder count for this token
      const { rows: [{ holders }] } = await pool.query(
        `SELECT COUNT(*)::int AS holders
         FROM public.token_balances
         WHERE token_id = $1 AND balance_wei::numeric > 0`,
        [token.id]
      )
      
      await pool.query(
        `UPDATE public.tokens
         SET holder_count = $1,
             holder_count_updated_at = NOW()
         WHERE id = $2`,
        [holders, token.id]
      )
      
    } catch (error) {
      console.warn(`Failed to process token ${token.id}:`, error)
    }
  }
  
  console.log(`Backfilled ${updatedBalances} DEX balances for ${tokens.length} tokens`)
}

// ---------- 3) Convenience: one-shot pipeline per chain ----------
export async function runPoolsPipelineForChain(chainId: number): Promise<void> {
  try {
    await normalizeAllAddresses(chainId)  // normalize all addresses to lowercase FIRST
    await discoverDexPools(chainId)  // auto-add pools after graduation
    await processDexPools(chainId)   // fill pair_snapshots + token_trades
    await backfillTraderAddresses(chainId)  // fix historical trader addresses
    await backfillDexBalances(chainId)  // backfill DEX trade balances
  } catch (e) {
    console.error(`Pools pipeline error on chain ${chainId}:`, e)
  }
}

// Run app-wide normalization once (not per chain)
export async function runAppWideNormalization(): Promise<void> {
  try {
    await normalizeAppWideAddresses()  // normalize app-wide tables
  } catch (e) {
    console.error(`App-wide normalization error:`, e)
  }
}
