import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ wallet: string }> }
) {
  try {
    const { wallet } = await params
    const chainId = req.nextUrl.searchParams.get('chainId')

    if (!wallet) {
      return NextResponse.json({ error: 'Wallet address is required' }, { status: 400 })
    }

    // Build chain filter condition
    const chainFilter = chainId ? `AND t.chain_id = ${chainId}` : ''

    const { rows: holdings } = await pool.query(`
      SELECT
        b.token_id,
        t.symbol,
        t.name,
        t.token_logo_asset_id,
        t.image,
        (b.balance_wei::numeric / 1e18) AS amount,
        ((b.balance_wei::numeric / 1e18) * t.current_price) AS value_eth
      FROM public.token_balances b
      JOIN public.tokens t ON t.id = b.token_id
      WHERE LOWER(b.holder) = LOWER($1) 
        AND b.balance_wei::numeric > 0
        ${chainFilter}
      ORDER BY value_eth DESC
    `, [wallet])

    // Add logoUrl to each holding
    const holdingsWithLogos = holdings.map(h => ({
      token_id: h.token_id,
      symbol: h.symbol,
      name: h.name,
      amount: Number(h.amount),
      value_eth: Number(h.value_eth),
      logoUrl: h.token_logo_asset_id
        ? `/api/media/${h.token_logo_asset_id}?v=thumb`
        : h.image || undefined
    }))

    return NextResponse.json(holdingsWithLogos)
  } catch (error) {
    console.error('[API] Failed to fetch held tokens:', error)
    return NextResponse.json({ error: 'Failed to fetch held tokens' }, { status: 500 })
  }
}
