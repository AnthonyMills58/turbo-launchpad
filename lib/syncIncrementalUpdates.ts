import db from './db'

/**
 * Update token balances incrementally for a single transaction
 */
export async function updateTokenBalances(
  tokenId: number,
  chainId: number,
  txHash: string
): Promise<void> {
  try {
    // Get the transfer record for this transaction
    const { rows: transferRows } = await db.query(`
      SELECT from_address, to_address, amount_wei, side
      FROM public.token_transfers
      WHERE token_id = $1 AND chain_id = $2 AND tx_hash = $3
    `, [tokenId, chainId, txHash])

    if (transferRows.length === 0) {
      console.log(`No transfer records found for token ${tokenId}, tx ${txHash}`)
      return
    }

    // Process each transfer in the transaction
    for (const transfer of transferRows) {
      const { from_address, to_address, amount_wei } = transfer
      const amount = BigInt(amount_wei)

      // Skip zero address transfers (mints)
      if (from_address === '0x0000000000000000000000000000000000000000') {
        // This is a mint - add to recipient balance
        await updateBalance(tokenId, chainId, to_address, amount, 'add')
      } else if (to_address === '0x0000000000000000000000000000000000000000') {
        // This is a burn - subtract from sender balance
        await updateBalance(tokenId, chainId, from_address, amount, 'subtract')
      } else {
        // This is a transfer - subtract from sender, add to recipient
        await updateBalance(tokenId, chainId, from_address, amount, 'subtract')
        await updateBalance(tokenId, chainId, to_address, amount, 'add')
      }
    }

    console.log(`✅ Updated token balances for token ${tokenId}, tx ${txHash}`)
  } catch (error) {
    console.error(`Error updating token balances for token ${tokenId}:`, error)
    throw error
  }
}

/**
 * Update a single user's balance
 */
async function updateBalance(
  tokenId: number,
  chainId: number,
  holder: string,
  amount: bigint,
  operation: 'add' | 'subtract'
): Promise<void> {
  if (amount === 0n) return

  const amountStr = amount.toString()
  const holderLower = holder.toLowerCase()
  
  if (operation === 'add') {
    // Add to balance
    await db.query(`
      INSERT INTO public.token_balances (token_id, chain_id, holder, balance_wei)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (token_id, holder) 
      DO UPDATE SET balance_wei = token_balances.balance_wei + $4
    `, [tokenId, chainId, holderLower, amountStr])
  } else {
    // Subtract from balance
    await db.query(`
      INSERT INTO public.token_balances (token_id, chain_id, holder, balance_wei)
      VALUES ($1, $2, $3, -$4)
      ON CONFLICT (token_id, holder)
      DO UPDATE SET balance_wei = token_balances.balance_wei - $4
    `, [tokenId, chainId, holderLower, amountStr])
  }

  // Clean up zero balances
  await db.query(`
    DELETE FROM public.token_balances 
    WHERE token_id = $1 AND chain_id = $2 AND holder = $3 AND balance_wei::numeric <= 0
  `, [tokenId, chainId, holderLower])
}

/**
 * Update token chart aggregations incrementally for a single transaction
 */
export async function updateTokenChart(
  tokenId: number,
  chainId: number,
  txHash: string
): Promise<void> {
  try {
    // Get the transfer record for this transaction
    const { rows: transferRows } = await db.query(`
      SELECT block_time, amount_eth_wei, price_eth_per_token, eth_price_usd, side
      FROM public.token_transfers
      WHERE token_id = $1 AND chain_id = $2 AND tx_hash = $3
        AND amount_eth_wei IS NOT NULL 
        AND amount_eth_wei <> 0
        AND price_eth_per_token IS NOT NULL
        AND price_eth_per_token > 0
    `, [tokenId, chainId, txHash])

    if (transferRows.length === 0) {
      console.log(`No trading data found for token ${tokenId}, tx ${txHash}`)
      return
    }

    // Process each transfer in the transaction
    for (const transfer of transferRows) {
      const { block_time, amount_eth_wei, price_eth_per_token, eth_price_usd } = transfer
      
      // Calculate 4-hour timestamp using PostgreSQL logic (same as worker)
      // This ensures timezone consistency with worker calculations

      // Convert amounts
      const volumeEth = Number(amount_eth_wei) / 1e18
      const volumeUsd = volumeEth * (eth_price_usd || 0)
      const priceEth = price_eth_per_token
      const priceUsd = priceEth * (eth_price_usd || 0)

      // Update 4-hour candle using PostgreSQL timestamp calculation
      await updateCandleWithPostgreSQL(
        tokenId, 
        chainId, 
        block_time, // Use the block_time from database directly
        priceEth, 
        priceUsd, 
        volumeEth, 
        volumeUsd
      )
    }

    console.log(`✅ Updated token chart for token ${tokenId}, tx ${txHash}`)
  } catch (error) {
    console.error(`Error updating token chart for token ${tokenId}:`, error)
    throw error
  }
}

/**
 * Update a single 4-hour candle using PostgreSQL timestamp calculation (same as worker)
 */
async function updateCandleWithPostgreSQL(
  tokenId: number,
  chainId: number,
  blockTime: Date | string, // Can be Date or string from database
  priceEth: number,
  priceUsd: number,
  volumeEth: number,
  volumeUsd: number
): Promise<void> {
  // Use PostgreSQL to calculate the 4-hour timestamp (same logic as worker)
  // Pass the block_time directly to PostgreSQL to avoid timezone conversion issues
  const { rows } = await db.query(`
    SELECT 
      DATE_TRUNC('day', $1::timestamptz) + 
      (FLOOR(EXTRACT(hour FROM $1::timestamptz) / 4) * 4) * interval '1 hour' as ts
  `, [blockTime])
  
  const fourHourTs = rows[0].ts

  // Insert or update the candle
  await db.query(`
    INSERT INTO public.token_chart_agg 
      (token_id, chain_id, interval_type, ts, 
       price_open_eth, price_high_eth, price_low_eth, price_close_eth,
       price_open_usd, price_high_usd, price_low_usd, price_close_usd,
       volume_eth, volume_usd, trades_count)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1)
    ON CONFLICT (token_id, interval_type, ts)
    DO UPDATE SET 
      price_high_eth = GREATEST(token_chart_agg.price_high_eth, $6),
      price_low_eth = LEAST(token_chart_agg.price_low_eth, $7),
      price_close_eth = $8,
      price_high_usd = GREATEST(token_chart_agg.price_high_usd, $10),
      price_low_usd = LEAST(token_chart_agg.price_low_usd, $11),
      price_close_usd = $12,
      volume_eth = token_chart_agg.volume_eth + $13,
      volume_usd = token_chart_agg.volume_usd + $14,
      trades_count = token_chart_agg.trades_count + 1
  `, [
    tokenId, chainId, '4h', fourHourTs,
    priceEth, priceEth, priceEth, priceEth, // OHLC for ETH
    priceUsd, priceUsd, priceUsd, priceUsd, // OHLC for USD
    volumeEth, volumeUsd
  ])
}
