import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string; interval: string }> }
) {
  try {
    const { tokenId: tokenIdParam, interval } = await params
    const tokenId = parseInt(tokenIdParam)
    
    if (isNaN(tokenId)) {
      return NextResponse.json({ error: 'Invalid token ID' }, { status: 400 })
    }

    // Validate interval
    const validIntervals = ['1m', '5m', '15m', '1h', '4h', '1d', '1w']
    if (!validIntervals.includes(interval)) {
      return NextResponse.json({ error: 'Invalid interval' }, { status: 400 })
    }

    // Choose the appropriate table and query based on interval
    let query: string
    let queryParams: (string | number)[]
    
    if (interval === '1d') {
      // Use token_daily_agg for daily data - get full history
      query = `
        SELECT 
          "day" as time,
          NULL as "open",
          NULL as high,
          NULL as low,
          NULL as "close",
          volume_token_wei,
          volume_eth_wei,
          volume_usd,
          transfers as trades_count
        FROM token_daily_agg 
        WHERE token_id = $1
        ORDER BY "day" ASC 
        LIMIT 500
      `
      queryParams = [tokenId]
    } else {
      // Use token_candles for intraday data - get full history
      query = `
        SELECT 
          ts as time,
          "open",
          high,
          low,
          "close",
          volume_token_wei,
          volume_eth_wei,
          volume_usd,
          trades_count
        FROM token_candles 
        WHERE token_id = $1 
          AND "interval" = $2
        ORDER BY ts ASC 
        LIMIT 500
      `
      queryParams = [tokenId, interval]
    }

    const result = await pool.query(query, queryParams)
    
    // Format data for TradingView Lightweight Charts
    const chartData = result.rows.map(row => ({
      time: interval === '1d' 
        ? Math.floor(new Date(row.time).getTime() / 1000) // Convert date to Unix timestamp
        : Math.floor(row.time.getTime() / 1000), // Unix timestamp in seconds
      open: parseFloat(row.open || 0),
      high: parseFloat(row.high || 0),
      low: parseFloat(row.low || 0),
      close: parseFloat(row.close || 0),
      volume: parseFloat(row.volume_token_wei || 0),
      volumeEth: Math.abs(parseFloat(row.volume_eth_wei || 0)), // Use absolute value for volume
      volumeUsd: Math.abs(parseFloat(row.volume_usd || 0)), // Use absolute value for volume
      tradesCount: parseInt(row.trades_count || 0),
    }))
    
    console.log('Volume data from database:', chartData.map(d => ({ time: d.time, volumeEth: d.volumeEth, volumeUsd: d.volumeUsd })))

    return NextResponse.json({
      data: chartData,
      interval,
      tokenId,
      count: chartData.length
    })
  } catch (error) {
    console.error('Error fetching chart data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chart data' },
      { status: 500 }
    )
  }
}
