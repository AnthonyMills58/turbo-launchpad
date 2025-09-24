import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tokenId = searchParams.get('tokenId')
    const chainId = searchParams.get('chainId')

    if (!tokenId || !chainId) {
      return NextResponse.json({ error: 'Missing tokenId or chainId' }, { status: 400 })
    }

    const { rows } = await db.query(`
      SELECT pair_address, token0, token1 
      FROM public.dex_pools 
      WHERE token_id = $1 AND chain_id = $2
    `, [parseInt(tokenId), parseInt(chainId)])

    if (rows.length === 0) {
      return NextResponse.json({ error: 'DEX pool not found' }, { status: 404 })
    }

    return NextResponse.json({
      pairAddress: rows[0].pair_address,
      token0: rows[0].token0,
      token1: rows[0].token1
    })
  } catch (error) {
    console.error('Error fetching DEX pool info:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
