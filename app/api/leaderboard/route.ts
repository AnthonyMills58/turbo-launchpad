import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const sort = searchParams.get('sort') || 'gainers_24h'
    const limit = parseInt(searchParams.get('limit') || '12')
    const excludeGraduated = searchParams.get('excludeGraduated') === 'true'

    // Build the ORDER BY clause based on sort parameter
    let orderBy = ''
    switch (sort) {
      case 'gainers_24h':
        orderBy = 'ORDER BY tlf.price_change_24h_pct DESC NULLS LAST'
        break
      case 'volume_24h':
        orderBy = 'ORDER BY tlf.volume_24h_usd DESC NULLS LAST'
        break
      case 'liquidity':
        orderBy = 'ORDER BY tlf.liquidity_effective_usd DESC NULLS LAST'
        break
      case 'top_raise':
        orderBy = 'ORDER BY t.eth_raised DESC NULLS LAST'
        break
      case 'raise_progress':
        orderBy = 'ORDER BY tlf.raise_progress_pct DESC NULLS LAST'
        break
      case 'market_cap':
        orderBy = 'ORDER BY t.market_cap DESC NULLS LAST'
        break
      case 'trades_24h':
        orderBy = 'ORDER BY tlf.trades_24h DESC NULLS LAST'
        break
      case 'newcomers':
        orderBy = 'ORDER BY t.created_at DESC NULLS LAST'
        break
      default:
        orderBy = 'ORDER BY tlf.price_change_24h_pct DESC NULLS LAST'
    }

    // Build WHERE clause for graduated tokens and criteria-specific filtering
    const whereConditions = []
    
    if (excludeGraduated) {
      whereConditions.push('t.is_graduated = FALSE')
    }
    
    // Add criteria-specific filtering
    switch (sort) {
      case 'gainers_24h':
        whereConditions.push('tlf.price_change_24h_pct IS NOT NULL AND tlf.price_change_24h_pct != 0')
        break
      // Other criteria don't need filtering - show all tokens
    }
    
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

    const query = `
      SELECT 
        t.*,
        tlf.eth_usd, tlf.volume_24h_usd, tlf.liquidity_effective_usd, 
        tlf.price_change_24h_pct, tlf.trades_24h, tlf.raise_progress_pct,
        CASE 
          WHEN t.market_cap > 0 THEN t.market_cap * epc.price_usd
          ELSE t.market_cap
        END as market_cap_usd
      FROM public.tokens_leaderboard_fast tlf
      JOIN public.tokens t ON t.id = tlf.id
      CROSS JOIN public.eth_price_cache epc
      ${whereClause}
      ${orderBy}
      LIMIT $1
    `

    const { rows } = await db.query(query, [limit])

    // Debug logging
    if (rows.length > 0) {
      console.log(`[Leaderboard API] Sort: ${sort}, First token data:`)
      console.log(`  - price_change_24h_pct: ${rows[0].price_change_24h_pct} (type: ${typeof rows[0].price_change_24h_pct})`)
      console.log(`  - market_cap: ${rows[0].market_cap} (type: ${typeof rows[0].market_cap})`)
      console.log(`  - volume_24h_usd: ${rows[0].volume_24h_usd} (type: ${typeof rows[0].volume_24h_usd})`)
      console.log(`  - trades_24h: ${rows[0].trades_24h} (type: ${typeof rows[0].trades_24h})`)
    }

    return NextResponse.json({ 
      tokens: rows,
      total: rows.length,
      sort,
      limit,
      excludeGraduated
    })
  } catch (error) {
    console.error('Leaderboard API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
