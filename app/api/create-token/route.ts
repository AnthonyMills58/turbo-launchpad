import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

interface CreateTokenRequest {
  name: string
  symbol: string
  description?: string
  image?: string
  twitter?: string
  telegram?: string
  website?: string
  supply: number
  raiseTarget: string
  dex: string
  curveType: string
  creatorAddress: string
  contractAddress: string
  chainId: number
  // NEW:
  minTokenAgeForUnlockSeconds?: number
  logoAssetId?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateTokenRequest

    const {
      name,
      symbol,
      description,
      image,
      twitter,
      telegram,
      website,
      supply,
      raiseTarget,
      dex,
      curveType,
      creatorAddress,
      contractAddress,
      chainId,
      minTokenAgeForUnlockSeconds,
      logoAssetId,
    } = body

    // Basic validation
    if (
      !name ||
      !symbol ||
      !raiseTarget ||
      !dex ||
      !curveType ||
      !creatorAddress ||
      !contractAddress ||
      typeof chainId !== 'number'
    ) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // NEW: default to 2 days if not provided by client
    const minAgeSecs =
      typeof minTokenAgeForUnlockSeconds === 'number' && minTokenAgeForUnlockSeconds > 0
        ? Math.floor(minTokenAgeForUnlockSeconds)
        : 172800 // 2 * 24 * 60 * 60

    const result = await pool.query(
      `
      INSERT INTO tokens (
        name, symbol, description, image, twitter, telegram, website,
        supply, raise_target, dex, curve_type,
        creator_wallet, contract_address, chain_id,
        min_token_age_for_unlock_seconds, token_logo_asset_id
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14,
        $15, $16
      )
      RETURNING id
      `,
      [
        name,
        symbol,
        description ?? null,
        image ?? null,
        twitter ?? null,
        telegram ?? null,
        website ?? null,
        supply,
        raiseTarget,
        dex,
        curveType,
        creatorAddress.toLowerCase(),
        contractAddress,
        chainId,
        minAgeSecs,
        logoAssetId ?? null,
      ]
    )

    return NextResponse.json({ success: true, tokenId: result.rows[0].id })
  } catch (error) {
    console.error('Error creating token:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}










