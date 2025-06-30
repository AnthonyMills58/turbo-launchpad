// /app/api/all-tokens/route.ts
import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET() {
  try {
    const result = await pool.query(
      'SELECT * FROM tokens WHERE contract_address IS NOT NULL ORDER BY id DESC'
    )
    return NextResponse.json(result.rows)
  } catch (err) {
    console.error('Error fetching all tokens:', err)
    return new NextResponse('Failed to fetch tokens', { status: 500 })
  }
}
