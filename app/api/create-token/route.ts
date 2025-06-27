import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const {
      name,
      description,
      image,
      twitter,
      telegram,
      supply,
      raiseTarget,
      dex,
      curveType, // ✅ include from frontend
    } = body

    // basic server-side sanity check
    if (!name || !description || !raiseTarget || !dex || !curveType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const result = await pool.query(
      `INSERT INTO tokens (
        name, description, image, twitter, telegram,
        supply, raise_target, dex, curve_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [name, description, image, twitter, telegram, supply, raiseTarget, dex, curveType]
    )

    return NextResponse.json({ success: true, tokenId: result.rows[0].id })
  } catch (error) {
    console.error('Error creating token:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

