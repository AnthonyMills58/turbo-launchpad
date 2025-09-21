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

    // Validate interval - only support 4h interval
    const validIntervals = ['4h']
    if (!validIntervals.includes(interval)) {
      return NextResponse.json({ error: 'Invalid interval. Supported: 4h' }, { status: 400 })
    }

    // Query token_chart_agg table for the specific interval
    const query = `
      SELECT 
        ts as time,
        price_open_usd,
        price_high_usd,
        price_low_usd,
        price_close_usd,
        price_open_usd,
        price_high_usd,
        price_low_usd,
        price_close_usd,
        volume_usd,
        volume_usd,
        trades_count
      FROM token_chart_agg 
      WHERE token_id = $1 
        AND interval_type = $2
      ORDER BY ts ASC
    `

    const result = await pool.query(query, [tokenId, interval])
    
    // Format data for TradingView Lightweight Charts
    const chartData = result.rows.map(row => ({
      time: Math.floor(row.time.getTime() / 1000), // Unix timestamp in seconds
      open: parseFloat(row.price_open_usd || 0),
      high: parseFloat(row.price_high_usd || 0),
      low: parseFloat(row.price_low_usd || 0),
      close: parseFloat(row.price_close_usd || 0),
      volume: parseFloat(row.volume_usd || 0), // Now in USD
      volumeEth: parseFloat(row.volume_usd || 0),
      volumeUsd: parseFloat(row.volume_usd || 0),
      tradesCount: parseInt(row.trades_count || 0)
    }))
    
    console.log(`Chart data for token ${tokenId}, interval ${interval}: ${chartData.length} candles`)
    if (chartData.length > 0) {
      console.log('Sample candle:', {
        time: chartData[0].time,
        open: chartData[0].open,
        high: chartData[0].high,
        low: chartData[0].low,
        close: chartData[0].close,
        volumeEth: chartData[0].volumeEth,
        volumeUsd: chartData[0].volumeUsd
      })
    }

    return NextResponse.json({
      data: chartData,
      interval,
      tokenId,
      count: chartData.length,
      source: 'token_chart_agg'
    })
  } catch (error) {
    console.error('Error fetching chart data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chart data' },
      { status: 500 }
    )
  }
}