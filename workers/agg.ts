import pool from '../lib/db'

/**
 * Aggregations & token summaries
 * - 1m OHLCV from DEX trades → token_candles('1m')
 * - 1h OHLCV by rolling up minutes → token_candles('1h')
 * - Daily aggregates → token_daily_agg
 * - Token summary cache → tokens.current_price, liquidity_eth/usd, fdv, market_cap, on_dex
 *
 * Notes:
 * - Prices are ETH per token (numeric).
 * - Liquidity is computed from latest pair_snapshots reserves:
 *     liquidity_eth = 2 * quote_reserve_eth
 *     liquidity_usd = liquidity_eth * eth_price_cache.price_usd
 * - FDV = (total_supply OR supply) * current_price
 * - Market Cap = circulating_supply (from token_balances) * current_price
 */

// -------------------- 1) Minute candles (1m) from token_trades --------------------
async function buildMinuteCandles(chainId: number): Promise<void> {
  const sql = `
WITH bounds AS (
  SELECT
    date_trunc('minute', NOW()) - interval '1 minute' AS end_min,
    COALESCE(
      (SELECT MAX(ts) + interval '1 minute'
       FROM public.token_candles
       WHERE chain_id = $1 AND "interval" = '1m'),
      (SELECT date_trunc('minute', MIN(block_time))
       FROM public.token_trades
       WHERE chain_id = $1 AND src = 'DEX')
    ) AS start_min
),
base AS (
  SELECT
    tr.token_id,
    date_trunc('minute', tr.block_time) AS bucket,
    tr.price_eth_per_token,
    tr.amount_token_wei,
    tr.amount_eth_wei,
    tr.block_time,
    tr.log_index
  FROM public.token_trades tr
  JOIN bounds b ON tr.block_time >= b.start_min AND tr.block_time < b.end_min
  WHERE tr.chain_id = $1 AND tr.src = 'DEX'
),
o AS (  -- open
  SELECT DISTINCT ON (token_id, bucket) token_id, bucket, price_eth_per_token AS open
  FROM base
  ORDER BY token_id, bucket, block_time ASC, log_index ASC
),
c AS (  -- close
  SELECT DISTINCT ON (token_id, bucket) token_id, bucket, price_eth_per_token AS close
  FROM base
  ORDER BY token_id, bucket, block_time DESC, log_index DESC
),
agg AS (
  SELECT
    token_id,
    bucket,
    MIN(price_eth_per_token) AS low,
    MAX(price_eth_per_token) AS high,
    COALESCE(SUM(amount_token_wei), 0) AS vol_tok_wei,
    COALESCE(SUM(amount_eth_wei),   0) AS vol_eth_wei,
    COUNT(*) AS trades_count
  FROM base
  GROUP BY token_id, bucket
)
INSERT INTO public.token_candles
  (token_id, chain_id, "interval", ts, "open", high, low, "close",
   volume_token_wei, volume_eth_wei, trades_count)
SELECT
  a.token_id, $1 AS chain_id, '1m' AS "interval", a.bucket AS ts,
  o.open, a.high, a.low, c.close,
  a.vol_tok_wei, a.vol_eth_wei, a.trades_count
FROM agg a
JOIN o ON (o.token_id = a.token_id AND o.bucket = a.bucket)
JOIN c ON (c.token_id = a.token_id AND c.bucket = a.bucket)
ON CONFLICT (token_id, "interval", ts) DO UPDATE SET
  "open" = EXCLUDED."open",
  high   = EXCLUDED.high,
  low    = EXCLUDED.low,
  "close"= EXCLUDED."close",
  volume_token_wei = EXCLUDED.volume_token_wei,
  volume_eth_wei   = EXCLUDED.volume_eth_wei,
  trades_count     = EXCLUDED.trades_count;
  `
  await pool.query(sql, [chainId])
}

// -------------------- 2) Hour candles (1h) by rolling up minutes --------------------
async function buildHourCandlesFromMinutes(chainId: number): Promise<void> {
  const sql = `
WITH bounds AS (
  SELECT
    date_trunc('hour', NOW()) - interval '1 hour' AS end_hour,
    COALESCE(
      (SELECT MAX(ts) + interval '1 hour'
       FROM public.token_candles
       WHERE chain_id = $1 AND "interval" = '1h'),
      (SELECT date_trunc('hour', MIN(ts))
       FROM public.token_candles
       WHERE chain_id = $1 AND "interval" = '1m')
    ) AS start_hour
),
mins AS (
  SELECT *
  FROM public.token_candles
  JOIN bounds b ON token_candles.ts >= b.start_hour AND token_candles.ts < b.end_hour
  WHERE chain_id = $1 AND "interval" = '1m'
),
open_c AS (
  SELECT DISTINCT ON (token_id, date_trunc('hour', ts))
    token_id,
    date_trunc('hour', ts) AS hour_bucket,
    "open" AS open
  FROM mins
  ORDER BY token_id, date_trunc('hour', ts), ts ASC
),
close_c AS (
  SELECT DISTINCT ON (token_id, date_trunc('hour', ts))
    token_id,
    date_trunc('hour', ts) AS hour_bucket,
    "close" AS close
  FROM mins
  ORDER BY token_id, date_trunc('hour', ts), ts DESC
),
agg AS (
  SELECT
    token_id,
    date_trunc('hour', ts) AS hour_bucket,
    MAX(high) AS high,
    MIN(low)  AS low,
    SUM(volume_token_wei) AS vol_tok_wei,
    SUM(volume_eth_wei)   AS vol_eth_wei,
    SUM(trades_count)     AS trades_count
  FROM mins
  GROUP BY token_id, date_trunc('hour', ts)
)
INSERT INTO public.token_candles
  (token_id, chain_id, "interval", ts, "open", high, low, "close",
   volume_token_wei, volume_eth_wei, trades_count)
SELECT
  a.token_id, $1 AS chain_id, '1h' AS "interval", a.hour_bucket AS ts,
  o.open, a.high, a.low, c.close,
  a.vol_tok_wei, a.vol_eth_wei, a.trades_count
FROM agg a
JOIN open_c  o ON (o.token_id = a.token_id AND o.hour_bucket = a.hour_bucket)
JOIN close_c c ON (c.token_id = a.token_id AND c.hour_bucket = a.hour_bucket)
ON CONFLICT (token_id, "interval", ts) DO UPDATE SET
  "open" = EXCLUDED."open",
  high   = EXCLUDED.high,
  low    = EXCLUDED.low,
  "close"= EXCLUDED."close",
  volume_token_wei = EXCLUDED.volume_token_wei,
  volume_eth_wei   = EXCLUDED.volume_eth_wei,
  trades_count     = EXCLUDED.trades_count;
  `
  await pool.query(sql, [chainId])
}

// -------------------- 3) Daily aggregates --------------------
async function refreshDailyAgg(chainId: number): Promise<void> {
  const sql = `
WITH last_day AS (
  SELECT COALESCE(
           MAX(day),
           (SELECT MIN(date(block_time)) - INTERVAL '1 day'
            FROM public.token_transfers
            WHERE chain_id = $1)
         ) AS d
  FROM public.token_daily_agg
  WHERE chain_id = $1
),
days AS (
  SELECT generate_series(
    (SELECT d FROM last_day)::date + 1,
    (NOW() AT TIME ZONE 'UTC')::date,
    interval '1 day'
  )::date AS day
),
toks AS (
  SELECT id AS token_id FROM public.tokens WHERE chain_id = $1
),
xfers AS (
  SELECT
    tt.token_id,
    (tt.block_time AT TIME ZONE 'UTC')::date AS day,
    COUNT(*) AS transfers,
    COUNT(DISTINCT tt.from_address) AS unique_senders,
    COUNT(DISTINCT tt.to_address)   AS unique_receivers
  FROM public.token_transfers tt
  WHERE tt.chain_id = $1
    AND (tt.block_time AT TIME ZONE 'UTC')::date >= (SELECT COALESCE(MIN(day), (NOW() AT TIME ZONE 'UTC')::date) FROM days)
  GROUP BY tt.token_id, (tt.block_time AT TIME ZONE 'UTC')::date
),
trades AS (
  SELECT
    tr.token_id,
    (tr.block_time AT TIME ZONE 'UTC')::date AS day,
    COUNT(*) AS trades_count,
    COALESCE(SUM(tr.amount_token_wei), 0) AS vol_token_wei,
    COALESCE(SUM(tr.amount_eth_wei),   0) AS vol_eth_wei,
    COUNT(DISTINCT tr.trader) AS unique_traders
  FROM public.token_trades tr
  WHERE tr.chain_id = $1
    AND (tr.block_time AT TIME ZONE 'UTC')::date >= (SELECT COALESCE(MIN(day), (NOW() AT TIME ZONE 'UTC')::date) FROM days)
  GROUP BY tr.token_id, (tr.block_time AT TIME ZONE 'UTC')::date
)
INSERT INTO public.token_daily_agg
  (token_id, chain_id, "day",
   transfers, unique_senders, unique_receivers, unique_traders,
   volume_token_wei, volume_eth_wei, holders_count)
SELECT
  tok.token_id,
  $1 AS chain_id,
  d.day,
  COALESCE(x.transfers, 0)        AS transfers,
  COALESCE(x.unique_senders, 0)   AS unique_senders,
  COALESCE(x.unique_receivers, 0) AS unique_receivers,
  COALESCE(tr.unique_traders, 0)  AS unique_traders,
  COALESCE(tr.vol_token_wei, 0)   AS volume_token_wei,
  COALESCE(tr.vol_eth_wei, 0)     AS volume_eth_wei,
  t.holder_count                  AS holders_count
FROM days d
CROSS JOIN toks tok
LEFT JOIN xfers  x  ON x.token_id = tok.token_id AND x.day = d.day
LEFT JOIN trades tr ON tr.token_id = tok.token_id AND tr.day = d.day
LEFT JOIN public.tokens t ON t.id = tok.token_id
ON CONFLICT (token_id, "day") DO UPDATE SET
  transfers        = EXCLUDED.transfers,
  unique_senders   = EXCLUDED.unique_senders,
  unique_receivers = EXCLUDED.unique_receivers,
  unique_traders   = EXCLUDED.unique_traders,
  volume_token_wei = EXCLUDED.volume_token_wei,
  volume_eth_wei   = EXCLUDED.volume_eth_wei,
  holders_count    = EXCLUDED.holders_count;
  `
  await pool.query(sql, [chainId])
}

// -------------------- 4) Token summary cache (current price, liquidity, FDV, mcap, on_dex) --------------------
async function refreshTokenSummariesForChain(chainId: number): Promise<void> {
  // Updates tokens: current_price, liquidity_eth/usd, fdv, market_cap, on_dex
  // - Price source: latest pair_snapshots (fallback to latest DEX trade price)
  // - Liquidity: from latest snapshot quote reserve
  // - FDV: (total_supply OR supply) * current_price
  // - Market cap: circulating (sum of token_balances) * current_price
  
  console.log(`\n=== Token summaries: chain ${chainId} ===`)
  
  // Debug: Check what data we have
  const debugSql = `
    SELECT 
      t.id, t.name, t.contract_address, t.base_price,
      dp.pair_address, dp.quote_token, dp.quote_decimals, dp.token_decimals,
      ps.price_eth_per_token as snapshot_price, ps.block_number as snapshot_block,
      tr.price_eth_per_token as trade_price, tr.block_time as trade_time
    FROM public.tokens t
    LEFT JOIN public.dex_pools dp ON dp.token_id = t.id AND dp.chain_id = t.chain_id
    LEFT JOIN LATERAL (
      SELECT ps2.*
      FROM public.pair_snapshots ps2
      WHERE ps2.chain_id = dp.chain_id AND ps2.pair_address = dp.pair_address
      ORDER BY ps2.block_number DESC LIMIT 1
    ) ps ON TRUE
    LEFT JOIN LATERAL (
      SELECT tr2.*
      FROM public.token_trades tr2
      WHERE tr2.chain_id = t.chain_id AND tr2.token_id = t.id AND tr2.src = 'DEX'
      ORDER BY tr2.block_time DESC, tr2.log_index DESC LIMIT 1
    ) tr ON TRUE
    WHERE t.chain_id = $1
    ORDER BY t.id
  `
  
  const { rows: debugRows } = await pool.query(debugSql, [chainId])
  console.log('Debug data for chain', chainId, ':', debugRows.map(r => ({
    id: r.id,
    name: r.name,
    base_price: r.base_price,
    has_pool: !!r.pair_address,
    snapshot_price: r.snapshot_price,
    trade_price: r.trade_price,
    final_price: r.snapshot_price || r.trade_price || r.base_price
  })))
  
  const sql = `
WITH ep AS (
  SELECT price_usd FROM public.eth_price_cache WHERE id = 1
),
-- Latest snapshot per token (via its pool)
last_snap AS (
  SELECT dp.token_id,
         dp.chain_id,
         ps.block_time,
         ps.price_eth_per_token,
         -- Use the same logic as pools.ts for reserve selection
         CASE
           WHEN lower(dp.quote_token) = lower(dp.token0) THEN ps.reserve0_wei
           ELSE ps.reserve1_wei
         END::numeric AS quote_reserve_wei,
         -- Get the correct decimals for calculations
         dp.quote_decimals,
         dp.token_decimals
  FROM public.dex_pools dp
  JOIN LATERAL (
    SELECT ps2.*
    FROM public.pair_snapshots ps2
    WHERE ps2.chain_id = dp.chain_id
      AND ps2.pair_address = dp.pair_address
    ORDER BY ps2.block_number DESC
    LIMIT 1
  ) ps ON TRUE
  WHERE dp.chain_id = $1
),
-- Fallback: latest DEX trade price per token
last_trade AS (
  SELECT DISTINCT ON (tr.token_id)
         tr.token_id, tr.chain_id, tr.price_eth_per_token
  FROM public.token_trades tr
  WHERE tr.chain_id = $1 AND tr.src = 'DEX' AND tr.token_id IS NOT NULL
  ORDER BY tr.token_id, tr.block_time DESC, tr.log_index DESC
),
-- Price + reserve source merged
price_src AS (
  SELECT
    t.id AS token_id,
    t.chain_id,
    -- Price priority: DEX snapshot → DEX trade → Base price
    COALESCE(
      ls.price_eth_per_token,           -- DEX snapshot (graduated tokens)
      lt.price_eth_per_token,           -- DEX trade (graduated tokens)
      t.base_price                      -- Base price (new tokens, no activity)
    ) AS current_price_eth,
    ls.quote_reserve_wei,
    ls.quote_decimals,
    ls.token_decimals
  FROM public.tokens t
  LEFT JOIN last_snap ls ON ls.token_id = t.id AND ls.chain_id = t.chain_id
  LEFT JOIN last_trade lt ON lt.token_id = t.id AND lt.chain_id = t.chain_id
  WHERE t.chain_id = $1
),
-- Circulating supply from balances (wei → tokens)
circ AS (
  SELECT tb.token_id,
         SUM(tb.balance_wei)::numeric AS circ_wei
  FROM public.token_balances tb
  JOIN public.tokens t ON t.id = tb.token_id AND t.chain_id = $1
  WHERE tb.balance_wei::numeric > 0
  GROUP BY tb.token_id
),
-- Whether a pool exists for the token (never unset on_dex to false)
has_pool AS (
  SELECT DISTINCT token_id, chain_id
  FROM public.dex_pools
  WHERE chain_id = $1
)
UPDATE public.tokens AS t
SET
  on_dex = CASE WHEN hp.token_id IS NOT NULL THEN TRUE ELSE t.on_dex END,
  -- Only update current_price for tokens that are on DEX
  current_price = CASE 
    WHEN hp.token_id IS NOT NULL THEN ps.current_price_eth 
    ELSE t.current_price 
  END,
  -- liquidity: use correct decimals from dex_pools table
  liquidity_eth = COALESCE( 
    (ps.quote_reserve_wei / power(10::numeric, COALESCE(ps.quote_decimals, 18))) * 2::numeric, 
    t.liquidity_eth 
  ),
  liquidity_usd = COALESCE( 
    (ps.quote_reserve_wei / power(10::numeric, COALESCE(ps.quote_decimals, 18))) * 2::numeric * (SELECT price_usd FROM ep), 
    t.liquidity_usd 
  ),
  -- valuations (ETH-denominated)
  fdv = CASE
    WHEN ps.current_price_eth IS NULL THEN t.fdv
    ELSE COALESCE(t.total_supply::numeric, t.supply::numeric, 0::numeric) * ps.current_price_eth
  END,
  market_cap = CASE
    WHEN ps.current_price_eth IS NULL OR c.circ_wei IS NULL THEN t.market_cap
    ELSE (c.circ_wei / power(10::numeric, COALESCE(ps.token_decimals, 18))) * ps.current_price_eth
  END,
  updated_at = NOW()
FROM price_src ps
LEFT JOIN circ c   ON c.token_id = ps.token_id
LEFT JOIN has_pool hp ON hp.token_id = ps.token_id AND hp.chain_id = ps.chain_id
WHERE t.id = ps.token_id AND t.chain_id = $1;
  `
  await pool.query(sql, [chainId])
}

// -------------------- Public API --------------------
export async function runAggPipelineForChain(chainId: number): Promise<void> {
  await buildMinuteCandles(chainId)            // 1m candles
  await buildHourCandlesFromMinutes(chainId)   // 1h candles
  await refreshDailyAgg(chainId)               // daily rollups
  await refreshTokenSummariesForChain(chainId) // tokens: price, liquidity, fdv, mcap, on_dex
}
