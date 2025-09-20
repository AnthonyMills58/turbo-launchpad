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

    // Note: intervalSeconds could be used for time bucketing if needed in the future
    // const intervalSeconds = {
    //   '1m': 60,
    //   '5m': 300,
    //   '15m': 900,
    //   '1h': 3600,
    //   '4h': 14400,
    //   '1d': 86400,
    //   '1w': 604800
    // }[interval] || 3600

    // Query token_transfers and aggregate by time buckets
    const query = `
      SELECT 
        DATE_TRUNC('${interval === '1m' ? 'minute' : interval === '1h' ? 'hour' : 'day'}', block_time) as time_bucket,
        COUNT(*) as trade_count,
        SUM(amount_eth) as volume_eth,
        SUM(amount_token) as volume_token,
        SUM(amount_eth * price_usd) as volume_usd,
        AVG(price_eth) as avg_price_eth,
        MIN(price_eth) as min_price_eth,
        MAX(price_eth) as max_price_eth,
        FIRST_VALUE(price_eth) OVER (PARTITION BY DATE_TRUNC('${interval === '1m' ? 'minute' : interval === '1h' ? 'hour' : 'day'}', block_time) ORDER BY block_time) as open_price,
        LAST_VALUE(price_eth) OVER (PARTITION BY DATE_TRUNC('${interval === '1m' ? 'minute' : interval === '1h' ? 'hour' : 'day'}', block_time) ORDER BY block_time ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) as close_price
      FROM token_transfers 
      WHERE token_id = $1
        AND block_time >= NOW() - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('${interval === '1m' ? 'minute' : interval === '1h' ? 'hour' : 'day'}', block_time)
      ORDER BY time_bucket ASC 
      LIMIT 200
    `

    const result = await pool.query(query, [tokenId])
    
    // Format data for TradingView Lightweight Charts
    const chartData = result.rows.map(row => ({
      time: Math.floor(new Date(row.time_bucket).getTime() / 1000), // Unix timestamp in seconds
      open: parseFloat(row.open_price || 0),
      high: parseFloat(row.max_price_eth || 0),
      low: parseFloat(row.min_price_eth || 0),
      close: parseFloat(row.close_price || 0),
      volume: parseFloat(row.volume_token || 0),
      volumeEth: parseFloat(row.volume_eth || 0),
      volumeUsd: parseFloat(row.volume_usd || 0),
      tradesCount: parseInt(row.trade_count || 0),
    }))

    return NextResponse.json({
      data: chartData,
      interval,
      tokenId,
      count: chartData.length,
      source: 'token_transfers'
    })
  } catch (error) {
    console.error('Error fetching volume data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch volume data' },
      { status: 500 }
    )
  }
}
