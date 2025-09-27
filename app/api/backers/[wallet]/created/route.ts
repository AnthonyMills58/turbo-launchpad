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

    const { rows: tokens } = await pool.query(`
      SELECT 
        t.id,
        t.symbol,
        t.name,
        t.current_price,
        t.market_cap,
        t.volume_24h_eth,
        t.token_logo_asset_id,
        t.image,
        t.created_at,
        t.is_graduated,
        t.on_dex,
        epc.price_usd AS eth_price_usd
      FROM public.tokens t
      CROSS JOIN public.eth_price_cache epc
      WHERE LOWER(t.creator_wallet) = LOWER($1)
        AND t.contract_address IS NOT NULL
        ${chainFilter}
      ORDER BY t.created_at DESC
    `, [wallet])

    return NextResponse.json(tokens)
  } catch (error) {
    console.error('[API] Failed to fetch created tokens:', error)
    return NextResponse.json({ error: 'Failed to fetch created tokens' }, { status: 500 })
  }
}
