import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const {
      name,
      symbol,
      description,
      image,
      twitter,
      telegram,
      website, // optional
      supply,
      raiseTarget,
      dex,
      curveType,
      creatorAddress,
      contractAddress,
      chainId, // ✅ NEW: must be passed from frontend
    } = body

    // ✅ Basic validation
    if (
      !name || !symbol || !description || !raiseTarget || !dex || !curveType ||
      !creatorAddress || !contractAddress || !chainId
    ) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const result = await pool.query(
      `INSERT INTO tokens (
        name, symbol, description, image, twitter, telegram, website,
        supply, raise_target, dex, curve_type,
        creator_wallet, contract_address, chain_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7,
              $8, $9, $10, $11, $12, $13, $14)
      RETURNING id`,
      [
        name,
        symbol,
        description,
        image,
        twitter,
        telegram,
        website ?? null,
        supply,
        raiseTarget,
        dex,
        curveType,
        creatorAddress.toLowerCase(),
        contractAddress,
        chainId, // ✅ Store chain ID in DB
      ]
    )

    return NextResponse.json({ success: true, tokenId: result.rows[0].id })
  } catch (error) {
    console.error('Error creating token:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}








