import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { contractAddress, dexUrl } = body

    if (!contractAddress || !dexUrl) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const result = await pool.query(
      `UPDATE tokens
       SET on_dex = true,
           dex_listing_url = $1
       WHERE contract_address = $2`,
      [dexUrl, contractAddress]
    )

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[MARK_DEX_LISTING]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

