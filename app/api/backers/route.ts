// app/api/backers/route.ts
import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { DEX_ROUTER_BY_CHAIN } from '@/lib/dex'

export async function GET() {
  try {
    // Get router addresses to exclude dynamically from dex.ts
    const routerAddresses = Object.values(DEX_ROUTER_BY_CHAIN).map(addr => `'${addr.toLowerCase()}'`).join(',')
    console.log('[API] Router addresses to exclude:', routerAddresses)
    
    // Build the exclusion part of the query
    const exclusionPart = `
      SELECT LOWER(contract_address) FROM public.tokens
      UNION ALL
      SELECT LOWER(pair_address) FROM public.dex_pools
      ${routerAddresses ? routerAddresses.split(',').map(addr => `UNION ALL SELECT ${addr}`).join(' ') : ''}
    `
    
    const { rows: backers } = await pool.query(`
      WITH portfolio AS (
        SELECT
          b.holder AS wallet,
          SUM((b.balance_wei::numeric / 1e18) * t.current_price) AS portfolio_eth,
          COUNT(DISTINCT b.token_id)       AS tokens_held
        FROM public.token_balances b
        JOIN public.tokens t ON t.id = b.token_id
        WHERE b.balance_wei::numeric >= 1e18
          AND LOWER(b.holder) NOT IN (${exclusionPart})
        GROUP BY b.holder
      ),
      created AS (
        SELECT
          creator_wallet AS wallet,
          COUNT(*) AS tokens_created,
          COUNT(*) FILTER (WHERE is_graduated = true) AS created_graduated,
          COUNT(*) FILTER (WHERE on_dex = true)    AS created_on_dex
        FROM public.tokens
        WHERE LOWER(creator_wallet) NOT IN (${exclusionPart})
        GROUP BY creator_wallet
      )
      SELECT
        COALESCE(p.wallet, c.wallet) AS wallet,
        COALESCE(p.portfolio_eth, 0) AS portfolio_eth,
        COALESCE(p.tokens_held, 0)   AS tokens_held,
        COALESCE(c.tokens_created, 0) AS tokens_created,
        COALESCE(c.created_graduated, 0) AS created_graduated,
        COALESCE(c.created_on_dex, 0) AS created_on_dex,
        epc.price_usd AS eth_price_usd
      FROM portfolio p
      FULL OUTER JOIN created c ON c.wallet = p.wallet
      CROSS JOIN public.eth_price_cache epc
      WHERE COALESCE(p.tokens_held, 0) > 0 OR COALESCE(c.tokens_created, 0) > 0
    `)

    console.log('[API] Found backers:', backers.length)
    console.log('[API] First backer sample:', backers[0])

    // For each backer, load profile data and top holdings
    for (const b of backers) {
      // Get profile data
      const { rows: profileRows } = await pool.query(
        `SELECT display_name, bio, avatar_asset_id FROM public.profiles WHERE wallet = $1`,
        [b.wallet]
      )
      
      const profile = profileRows[0] || {}
      b.display_name = profile.display_name
      b.bio = profile.bio
      b.avatar_asset_id = profile.avatar_asset_id

      // Get top holdings
      const { rows: holdings } = await pool.query(
        `
        SELECT
          b.holder,
          b.token_id,
          t.symbol,
          t.token_logo_asset_id,
          t.image,
          (b.balance_wei::numeric / 1e18) AS amount,
          ((b.balance_wei::numeric / 1e18) * t.current_price) AS value_eth
        FROM public.token_balances b
        JOIN public.tokens t ON t.id = b.token_id
        WHERE b.holder = $1 AND b.balance_wei::numeric > 0
        ORDER BY value_eth DESC
        LIMIT 3;
        `,
        [b.wallet]
      )

      const total = Number(b.portfolio_eth) || 0
      b.top_holdings = holdings.map(h => ({
        tokenId: h.token_id,
        symbol: h.symbol,
        logoUrl: h.token_logo_asset_id
          ? `/api/media/${h.token_logo_asset_id}?v=thumb`
          : h.image || undefined,
        amount: Number(h.amount),
        valueEth: Number(h.value_eth),
        percent: total > 0 ? (Number(h.value_eth) / total) * 100 : 0
      }))
    }

    console.log('[API] Returning backers data')
    return NextResponse.json(backers)
  } catch (e) {
    console.error('[API] Backers query failed:', e)
    return NextResponse.json({ error: 'Failed to load backers' }, { status: 500 })
  }
}
