import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tokenId = searchParams.get('tokenId')
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const offset = (page - 1) * pageSize

    if (!tokenId) {
      return NextResponse.json({ success: false, error: 'Token ID is required' }, { status: 400 })
    }

    // First, get total count and total supply
    const countQuery = `
      SELECT 
        COUNT(*) as total,
        COALESCE(SUM(b.balance_wei), 0) as total_supply
      FROM token_balances b
      LEFT JOIN dex_pools d ON b.token_id = d.token_id AND LOWER(b.holder) = LOWER(d.pair_address)
      LEFT JOIN tokens t ON b.token_id = t.id AND LOWER(b.holder) = LOWER(t.contract_address)
      LEFT JOIN tokens t2 ON b.token_id = t2.id
      LEFT JOIN profiles p ON b.holder = p.wallet
      CROSS JOIN eth_price_cache e
      WHERE d.pair_address IS NULL 
        AND t.contract_address IS NULL 
        AND t2.id = $1
    `

    // Then get paginated results
    const dataQuery = `
      SELECT 
        t2.id,
        t2.current_price,
        e.price_usd,
        b.holder,
        p.display_name as holder_name,
        b.balance_wei as amount
      FROM token_balances b
      LEFT JOIN dex_pools d ON b.token_id = d.token_id AND LOWER(b.holder) = LOWER(d.pair_address)
      LEFT JOIN tokens t ON b.token_id = t.id AND LOWER(b.holder) = LOWER(t.contract_address)
      LEFT JOIN tokens t2 ON b.token_id = t2.id
      LEFT JOIN profiles p ON b.holder = p.wallet
      CROSS JOIN eth_price_cache e
      WHERE d.pair_address IS NULL 
        AND t.contract_address IS NULL 
        AND t2.id = $1
      ORDER BY b.balance_wei DESC
      LIMIT $2 OFFSET $3
    `

    // Get total count and total supply
    const countResult = await pool.query(countQuery, [tokenId])
    const totalCount = parseInt(countResult.rows[0].total)
    const totalSupply = parseFloat(countResult.rows[0].total_supply)
    const totalPages = Math.ceil(totalCount / pageSize)

    // Get paginated data
    const dataResult = await pool.query(dataQuery, [tokenId, pageSize, offset])

    return NextResponse.json({
      success: true,
      holders: dataResult.rows,
      totalCount,
      totalSupply,
      totalPages,
      currentPage: page,
      pageSize,
    })
  } catch (error) {
    console.error('Error fetching holders:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch holders' },
      { status: 500 }
    )
  }
}
