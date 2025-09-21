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

    // Query sparse data from token_chart_agg and generate continuous time series with gap-filling
    const query = `
      WITH token_lifespan AS (
        -- Get token's actual lifespan from first transfer to now
        SELECT 
          MIN(block_time) as start_time,
          NOW() as end_time
        FROM token_transfers 
        WHERE token_id = $1
      ),
      time_series AS (
        -- Generate continuous 4-hour intervals for token's actual lifespan
        SELECT generate_series(
          DATE_TRUNC('day', tl.start_time) + 
            (EXTRACT(hour FROM tl.start_time)::int / 4) * interval '4 hours',
          DATE_TRUNC('day', tl.end_time) + interval '1 day' - interval '1 second',
          '4 hours'::interval
        ) as ts
        FROM token_lifespan tl
      ),
      sparse_data AS (
        -- Get sparse data from token_chart_agg
        SELECT 
          ts as time,
          price_open_usd,
          price_high_usd,
          price_low_usd,
          price_close_usd,
          volume_usd,
          trades_count
        FROM token_chart_agg 
        WHERE token_id = $1 
          AND interval_type = $2
      ),
      price_timeline AS (
        -- Create price timeline for forward-filling gaps
        SELECT 
          ts.ts,
          -- Get the last known price before or at this timestamp
          (SELECT price_close_usd FROM sparse_data 
           WHERE time <= ts.ts 
           ORDER BY time DESC 
           LIMIT 1) as last_price
        FROM time_series ts
      )
      -- Combine time series with sparse data, filling gaps with last known price
      SELECT 
        ts.ts as time,
        COALESCE(sd.price_open_usd, pt.last_price, 0) as price_open_usd,
        COALESCE(sd.price_high_usd, pt.last_price, 0) as price_high_usd,
        COALESCE(sd.price_low_usd, pt.last_price, 0) as price_low_usd,
        COALESCE(sd.price_close_usd, pt.last_price, 0) as price_close_usd,
        COALESCE(sd.volume_usd, 0) as volume_usd,
        COALESCE(sd.trades_count, 0) as trades_count
      FROM time_series ts
      LEFT JOIN sparse_data sd ON ts.ts = sd.time
      LEFT JOIN price_timeline pt ON ts.ts = pt.ts
      ORDER BY ts.ts ASC
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