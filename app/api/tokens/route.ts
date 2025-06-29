import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET(req: NextRequest) {
  const creator = req.nextUrl.searchParams.get('creator')

  if (!creator) {
    return NextResponse.json({ tokens: [] })
  }

  const result = await pool.query(
    'SELECT * FROM tokens WHERE creator_wallet = $1 AND contract_address IS NOT NULL ORDER BY id DESC',
    [creator.toLowerCase()]
  )

  return NextResponse.json({ tokens: result.rows })
}
