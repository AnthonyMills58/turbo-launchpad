import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { contractAddress, dexPrice, fdv, marketCap } = body

    console.log('[DEX_UPDATE_PRICE] Received body:', body)

    if (!contractAddress || !dexPrice) {
      console.warn('[DEX_UPDATE_PRICE] Missing required fields')
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const result = await pool.query(
      `UPDATE tokens
       SET current_price = $1,
           fdv = $2,
           market_cap = $3,
           last_synced_at = NOW()
       WHERE contract_address = $4`,
      [dexPrice, fdv, marketCap, contractAddress]
    )

    if (result.rowCount === 0) {
      console.warn('[DEX_UPDATE_PRICE] Token not found in DB:', contractAddress)
      return NextResponse.json({ error: 'Token not found' }, { status: 404 })
    }

    console.log('[DEX_UPDATE_PRICE] Update successful for:', contractAddress)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DEX_UPDATE_PRICE] Internal error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

