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

    // Query token_candles table for OHLCV data
    const query = `
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
        AND "interval" = '1m'
      ORDER BY ts ASC, token_id ASC
      LIMIT 100
    `

    console.log(`Querying token_candles for tokenId: ${tokenId}`)
    const result = await pool.query(query, [tokenId])
    console.log(`Found ${result.rows.length} rows for tokenId: ${tokenId}`)
    
    // Format data for TradingView Lightweight Charts
    const chartData = result.rows.map(row => ({
      time: Math.floor(row.time.getTime() / 1000), // Unix timestamp in seconds
      open: parseFloat(row.open || 0),
      high: parseFloat(row.high || 0),
      low: parseFloat(row.low || 0),
      close: parseFloat(row.close || 0),
      volume: parseFloat(row.volume_token_wei || 0) / 1e18, // Convert wei to tokens
      volumeEth: parseFloat(row.volume_eth_wei || 0) / 1e18, // Convert wei to ETH
      volumeUsd: parseFloat(row.volume_usd || 0),
      tradesCount: parseInt(row.trades_count || 0),
    }))

    // Log all data before any processing
    console.log(`Raw data: ${chartData.length} candles`)
    console.log('Sample data:', chartData.slice(0, 3))

    // Remove duplicates by time (keep the last one for each timestamp)
    const uniqueData = chartData.reduce((acc, current) => {
      const existingIndex = acc.findIndex(item => item.time === current.time)
      if (existingIndex >= 0) {
        console.log(`Duplicate timestamp found: ${current.time}, replacing existing`)
        acc[existingIndex] = current // Replace with latest data
      } else {
        acc.push(current)
      }
      return acc
    }, [] as typeof chartData)

    console.log(`After deduplication: ${uniqueData.length} unique candles`)
    console.log('Unique timestamps:', uniqueData.map(d => d.time))

    return NextResponse.json(uniqueData)
  } catch (error) {
    console.error('Error fetching chart data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chart data' },
      { status: 500 }
    )
  }
}
