import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  try {
    const { tokenId: tokenIdParam } = await params
    const tokenId = parseInt(tokenIdParam)
    
    if (isNaN(tokenId)) {
      return NextResponse.json({ error: 'Invalid token ID' }, { status: 400 })
    }

    // Get token creation date to determine full time range
    const tokenQuery = `
      SELECT created_at 
      FROM tokens 
      WHERE id = $1
    `
    const tokenResult = await pool.query(tokenQuery, [tokenId])
    
    if (tokenResult.rows.length === 0) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 })
    }
    
    const tokenCreatedAt = tokenResult.rows[0].created_at
    console.log(`Token ${tokenId} created at: ${tokenCreatedAt}`)

    // Get all transactions for this token, ordered by time
    const transactionsQuery = `
      SELECT 
        block_time,
        price_eth_per_token as price_eth,
        amount_eth_wei,
        amount_wei as amount_token,
        eth_price_USD as price_usd
      FROM token_transfers 
      WHERE token_id = $1
        AND block_time >= $2
      ORDER BY block_time ASC
    `
    
    const transactionsResult = await pool.query(transactionsQuery, [tokenId, tokenCreatedAt])
    console.log(`Found ${transactionsResult.rows.length} transactions for token ${tokenId}`)
    
    if (transactionsResult.rows.length === 0) {
      return NextResponse.json({ data: [], count: 0, source: 'token_transfers' })
    }

    // Create daily candles from transaction data
    const dailyCandles = new Map()
    
    transactionsResult.rows.forEach((tx) => {
      const day = tx.block_time.toISOString().split('T')[0] // YYYY-MM-DD
      
      if (!dailyCandles.has(day)) {
        dailyCandles.set(day, {
          time: day,
          open: tx.price_eth,
          high: tx.price_eth,
          low: tx.price_eth,
          close: tx.price_eth,
          volumeEth: 0,
          volumeUsd: 0,
          tradesCount: 0,
          transactions: []
        })
      }
      
      const candle = dailyCandles.get(day)
      candle.high = Math.max(candle.high, tx.price_eth)
      candle.low = Math.min(candle.low, tx.price_eth)
      candle.close = tx.price_eth // Last transaction of the day
      // Use absolute value for volume (volume should always be positive)
      // amount_eth_wei is in wei, so we need to convert to ETH for volume calculation
      const amountEth = Math.abs(parseFloat(tx.amount_eth_wei || 0)) / 1e18
      candle.volumeEth += amountEth
      candle.volumeUsd += amountEth * parseFloat(tx.price_usd || 0)
      candle.tradesCount += 1
      candle.transactions.push(tx)
    })
    
    // Convert to array and format for chart
    const chartData = Array.from(dailyCandles.values()).map(candle => ({
      time: Math.floor(new Date(candle.time).getTime() / 1000), // Unix timestamp
      open: parseFloat(candle.open || 0),
      high: parseFloat(candle.high || 0),
      low: parseFloat(candle.low || 0),
      close: parseFloat(candle.close || 0),
      volume: 0, // Not used for volume display
      volumeEth: candle.volumeEth, // Keep as ETH (already converted from wei)
      volumeUsd: candle.volumeUsd,
      tradesCount: candle.tradesCount,
    }))
    
    console.log(`Created ${chartData.length} daily candles from ${transactionsResult.rows.length} transactions`)
    console.log('Sample candle:', chartData[0])
    console.log('Volume values:', chartData.map(d => ({ time: d.time, volumeEth: d.volumeEth, volumeUsd: d.volumeUsd })))

    return NextResponse.json({
      data: chartData,
      interval: '1d',
      tokenId,
      count: chartData.length,
      source: 'token_transfers_aggregated',
      tokenCreatedAt: tokenCreatedAt
    })
  } catch (error) {
    console.error('Error fetching sparse chart data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sparse chart data' },
      { status: 500 }
    )
  }
}
