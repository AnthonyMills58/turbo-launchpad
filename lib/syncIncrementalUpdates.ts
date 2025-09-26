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
      DO UPDATE SET balance_wei = token_balances.balance_wei::numeric + $4::numeric
    `, [tokenId, chainId, holderLower, amountStr])
  } else {
    // Subtract from balance
    await db.query(`
      INSERT INTO public.token_balances (token_id, chain_id, holder, balance_wei)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (token_id, holder)
      DO UPDATE SET balance_wei = token_balances.balance_wei::numeric - $4::numeric
    `, [tokenId, chainId, holderLower, amountStr])
  }

  // Clean up zero balances
  await db.query(`
    DELETE FROM public.token_balances 
    WHERE token_id = $1 AND chain_id = $2 AND holder = $3 AND balance_wei::numeric <= 0::numeric
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
  console.log(`[updateTokenChart] Starting chart update for token ${tokenId}, tx ${txHash}`)
  try {
    // Get the transfer records for this transaction
    const { rows: transferRows } = await db.query(`
      SELECT block_time, amount_eth_wei, price_eth_per_token, eth_price_usd, side, log_index
      FROM public.token_transfers
      WHERE token_id = $1 AND chain_id = $2 AND tx_hash = $3
        AND amount_eth_wei IS NOT NULL 
        AND amount_eth_wei <> 0
        AND price_eth_per_token IS NOT NULL
        AND price_eth_per_token > 0
      ORDER BY block_time ASC, log_index ASC
    `, [tokenId, chainId, txHash])

    if (transferRows.length === 0) {
      console.log(`No trading data found for token ${tokenId}, tx ${txHash}`)
      return
    }

    console.log(`Found ${transferRows.length} transfer records for token ${tokenId}, tx ${txHash}`)

    // Get the block time from the first transfer record
    const blockTime = transferRows[0].block_time
    console.log(`Block time from transfer: ${blockTime}`)

    // Calculate the 4-hour bucket timestamp (same logic as worker)
    const { rows: tsRows } = await db.query(`
      SELECT 
        DATE_TRUNC('day', $1::timestamptz) + 
        (FLOOR(EXTRACT(hour FROM $1::timestamptz) / 4) * 4) * interval '1 hour' as ts
    `, [blockTime])
    
    const fourHourTs = tsRows[0].ts
    console.log(`Calculated 4h bucket: ${fourHourTs}`)
    console.log(`Bucket range: ${fourHourTs} to ${new Date(new Date(fourHourTs).getTime() + 4 * 60 * 60 * 1000)}`)

    // Delete existing records for this token and 4-hour bucket (same as worker)
    console.log(`Deleting existing candles for token ${tokenId}, 4h bucket: ${fourHourTs}`)
    const deleteResult = await db.query(`
      DELETE FROM public.token_chart_agg 
      WHERE token_id = $1 AND chain_id = $2 AND interval_type = '4h' AND ts = $3
    `, [tokenId, chainId, fourHourTs])
    console.log(`Deleted ${deleteResult.rowCount} existing candles`)

    // First, let's see what transfers exist for this token in this time range
    const { rows: allTransfers } = await db.query(`
      SELECT block_time, log_index, side, amount_eth_wei, price_eth_per_token
      FROM token_transfers 
      WHERE token_id = $1 
        AND chain_id = $2
        AND block_time >= $3
        AND block_time < $3 + interval '4 hours'
        AND amount_eth_wei IS NOT NULL 
        AND amount_eth_wei <> 0
        AND price_eth_per_token IS NOT NULL
        AND price_eth_per_token > 0
      ORDER BY block_time ASC, log_index ASC
    `, [tokenId, chainId, fourHourTs])
    
    console.log(`Found ${allTransfers.length} transfers in 4h bucket for aggregation:`)
    allTransfers.forEach((t, i) => {
      console.log(`  ${i+1}. ${t.side} - ${t.block_time} - log_index: ${t.log_index} - price: ${t.price_eth_per_token}`)
    })

    // Aggregate all transfers for this token in this 4-hour bucket (exact worker logic)
    const { rows: aggRows } = await db.query(`
      SELECT 
        COUNT(*) as trades_count,
        SUM(amount_eth_wei/1e18) as volume_eth,
        SUM((amount_eth_wei/1e18) * COALESCE(eth_price_usd, 0)) as volume_usd,
        MIN(price_eth_per_token) as price_low_eth,
        MAX(price_eth_per_token) as price_high_eth,
        (ARRAY_AGG(price_eth_per_token ORDER BY block_time ASC, log_index ASC))[1] as price_open_eth,
        (ARRAY_AGG(price_eth_per_token ORDER BY block_time DESC, log_index DESC))[1] as price_close_eth,
        (ARRAY_AGG(price_eth_per_token * COALESCE(eth_price_usd, 0) ORDER BY block_time ASC, log_index ASC))[1] as price_open_usd,
        (ARRAY_AGG(price_eth_per_token * COALESCE(eth_price_usd, 0) ORDER BY block_time DESC, log_index DESC))[1] as price_close_usd,
        MIN(price_eth_per_token * COALESCE(eth_price_usd, 0)) as price_low_usd,
        MAX(price_eth_per_token * COALESCE(eth_price_usd, 0)) as price_high_usd
      FROM token_transfers 
      WHERE token_id = $1 
        AND chain_id = $2
        AND block_time >= $3
        AND block_time < $3 + interval '4 hours'
        AND amount_eth_wei IS NOT NULL 
        AND amount_eth_wei <> 0
        AND price_eth_per_token IS NOT NULL
        AND price_eth_per_token > 0
    `, [tokenId, chainId, fourHourTs])

    const agg = aggRows[0]

    // Only insert if there are trades in this bucket
    if (agg.trades_count > 0) {
      await db.query(`
        INSERT INTO public.token_chart_agg 
          (token_id, chain_id, interval_type, ts, 
           price_open_eth, price_high_eth, price_low_eth, price_close_eth,
           price_open_usd, price_high_usd, price_low_usd, price_close_usd,
           volume_eth, volume_usd, trades_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `, [
        tokenId, chainId, '4h', fourHourTs,
        agg.price_open_eth, agg.price_high_eth, agg.price_low_eth, agg.price_close_eth,
        agg.price_open_usd, agg.price_high_usd, agg.price_low_usd, agg.price_close_usd,
        agg.volume_eth, agg.volume_usd, agg.trades_count
      ])

      console.log(`✅ Aggregated ${agg.trades_count} trades for token ${tokenId}, 4h bucket: ${fourHourTs}`)
    } else {
      console.log(`No trades found for token ${tokenId} in 4h bucket: ${fourHourTs}`)
    }
  } catch (error) {
    console.error(`Error updating token chart for token ${tokenId}:`, error)
    throw error
  }
}


