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
      curveType,
      creatorAddress,
      contractAddress, // ✅ comes from frontend
    } = body

    if (!name || !description || !raiseTarget || !dex || !curveType || !creatorAddress || !contractAddress) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const result = await pool.query(
      `INSERT INTO tokens (
        name, description, image, twitter, telegram,
        supply, raise_target, dex, curve_type,
        creator_wallet, contract_address
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        name,
        description,
        image,
        twitter,
        telegram,
        supply,
        raiseTarget,
        dex,
        curveType,
        creatorAddress.toLowerCase(),
        contractAddress,
      ]
    )

    return NextResponse.json({ success: true, tokenId: result.rows[0].id })
  } catch (error) {
    console.error('Error creating token:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}





