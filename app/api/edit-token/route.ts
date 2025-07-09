import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const {
      tokenId,
      website,
      twitter,
      telegram,
      dex,
      description,
      image,
    } = data

    if (!tokenId) {
      return NextResponse.json({ message: 'Missing tokenId' }, { status: 400 })
    }

    await pool.query(
      `
      UPDATE tokens
      SET
        website = $1,
        twitter = $2,
        telegram = $3,
        dex = $4,
        description = $5,
        image = $6,
        updated_at = NOW()
      WHERE id = $7
    `,
      [
        website || null,
        twitter || null,
        telegram || null,
        dex || null,
        description || null,
        image || null,
        tokenId,
      ]
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('❌ Failed to update token:', err)
    return NextResponse.json(
      { message: 'Failed to update token' },
      { status: 500 }
    )
  }
}

