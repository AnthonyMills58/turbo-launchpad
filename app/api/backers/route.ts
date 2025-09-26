// app/api/backers/route.ts
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET() {
  try {
    const { rows: backers } = await pool.query(`
      WITH portfolio AS (
        SELECT
          b.wallet,
          SUM(b.balance * t.current_price) AS portfolio_eth,
          COUNT(DISTINCT b.token_id)       AS tokens_held
        FROM token_balances b
        JOIN tokens t ON t.id = b.token_id
        WHERE b.balance > 0
        GROUP BY b.wallet
      ),
      created AS (
        SELECT
          owner_wallet AS wallet,
          COUNT(*) AS tokens_created,
          COUNT(*) FILTER (WHERE graduated = true) AS created_graduated,
          COUNT(*) FILTER (WHERE on_dex = true)    AS created_on_dex
        FROM tokens
        GROUP BY owner_wallet
      )
      SELECT
        COALESCE(p.wallet, c.wallet) AS wallet,
        COALESCE(p.portfolio_eth, 0) AS portfolio_eth,
        COALESCE(p.tokens_held, 0)   AS tokens_held,
        COALESCE(c.tokens_created, 0) AS tokens_created,
        COALESCE(c.created_graduated, 0) AS created_graduated,
        COALESCE(c.created_on_dex, 0) AS created_on_dex
      FROM portfolio p
      FULL OUTER JOIN created c ON c.wallet = p.wallet
    `)

    // For each backer, load top holdings
    for (const b of backers) {
      const { rows: holdings } = await pool.query(
        `
        SELECT
          b.wallet,
          b.token_id,
          t.symbol,
          t.token_logo_asset_id,
          b.balance AS amount,
          (b.balance * t.current_price) AS value_eth
        FROM token_balances b
        JOIN tokens t ON t.id = b.token_id
        WHERE b.wallet = $1 AND b.balance > 0
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
          : undefined,
        amount: Number(h.amount),
        valueEth: Number(h.value_eth),
        percent: total > 0 ? (Number(h.value_eth) / total) * 100 : 0
      }))
    }

    return NextResponse.json(backers)
  } catch (e) {
    console.error('Backers query failed:', e)
    return NextResponse.json({ error: 'Failed to load backers' }, { status: 500 })
  }
}
