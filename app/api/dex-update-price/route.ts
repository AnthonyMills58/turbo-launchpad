import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { contractAddress, dexPrice, fdv, marketCap } = body

    if (!contractAddress || !dexPrice) {
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
      return NextResponse.json({ error: 'Token not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DEX_UPDATE_PRICE]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
