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
    const side = searchParams.get('side')
    const maker = searchParams.get('maker')

    if (!tokenId) {
      return NextResponse.json({ error: 'Token ID is required' }, { status: 400 })
    }

    const offset = (page - 1) * pageSize

    // Build WHERE clause
    let whereClause = 'tt.token_id = $1 AND tt.side != \'MINT\''
    const params: any[] = [tokenId]
    let paramIndex = 2

    if (side) {
      whereClause += ` AND tt.side = $${paramIndex}`
      params.push(side)
      paramIndex++
    }

    if (maker) {
      whereClause += ` AND (
        tt.from_address ILIKE $${paramIndex} OR 
        tt.to_address ILIKE $${paramIndex} OR
        t.creator_wallet ILIKE $${paramIndex}
      )`
      params.push(`%${maker}%`)
      paramIndex++
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM token_transfers tt
      JOIN tokens t ON tt.token_id = t.id
      WHERE ${whereClause}
    `
    
    const { rows: countRows } = await pool.query(countQuery, params)
    const totalCount = parseInt(countRows[0].total)

    // Get transactions with pagination
    const transactionsQuery = `
      SELECT 
        tt.id,
        tt.block_time,
        tt.tx_hash,
        tt.from_address,
        tt.to_address,
        tt.amount_wei,
        tt.amount_eth_wei,
        tt.price_eth_per_token,
        tt.side,
        tt.src,
        tt.eth_price_usd,
        t.creator_wallet
      FROM token_transfers tt
      JOIN tokens t ON tt.token_id = t.id
      WHERE ${whereClause}
      ORDER BY tt.block_time DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `

    params.push(pageSize, offset)
    const { rows: transactions } = await pool.query(transactionsQuery, params)

    const totalPages = Math.ceil(totalCount / pageSize)

    return NextResponse.json({
      transactions,
      totalCount,
      totalPages,
      currentPage: page,
      pageSize
    })

  } catch (error) {
    console.error('Error fetching transactions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch transactions' },
      { status: 500 }
    )
  }
}
