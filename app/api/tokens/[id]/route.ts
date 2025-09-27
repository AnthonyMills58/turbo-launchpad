import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tokenId } = await params

    if (!tokenId || isNaN(Number(tokenId))) {
      return NextResponse.json({ error: 'Invalid token ID' }, { status: 400 })
    }

    const result = await pool.query(
      'SELECT * FROM public.tokens WHERE id = $1',
      [tokenId]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 })
    }

    return NextResponse.json(result.rows[0])
  } catch (error) {
    console.error('[API] Failed to fetch token:', error)
    return NextResponse.json({ error: 'Failed to fetch token' }, { status: 500 })
  }
}
