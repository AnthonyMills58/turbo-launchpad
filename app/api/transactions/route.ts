import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tokenId = searchParams.get('tokenId')
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const side = searchParams.get('side')
    const maker = searchParams.get('maker')
    const creatorWallet = searchParams.get('creatorWallet')

    if (!tokenId) {
      return NextResponse.json({ error: 'Token ID is required' }, { status: 400 })
    }

    const offset = (page - 1) * pageSize

    // Build WHERE clause
    let whereClause = 'token_id = $1 AND side != \'MINT\''
    const params: (string | number)[] = [tokenId]
    let paramIndex = 2

    if (side) {
      whereClause += ` AND side = $${paramIndex}`
      params.push(side)
      paramIndex++
    }

    if (maker) {
      whereClause += ` AND (
        from_address ILIKE $${paramIndex} OR 
        to_address ILIKE $${paramIndex} OR
        $${paramIndex + 1} ILIKE $${paramIndex}
      )`
      params.push(`%${maker}%`, creatorWallet || '')
      paramIndex += 2
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM token_transfers
      WHERE ${whereClause}
    `
    
    const { rows: countRows } = await pool.query(countQuery, params)
    const totalCount = parseInt(countRows[0].total)
    
    console.log('🔍 Transaction API Debug:', {
      tokenId,
      whereClause,
      params,
      totalCount
    })

    // Get transactions with pagination
    const transactionsQuery = `
      SELECT 
        id,
        block_time,
        tx_hash,
        from_address,
        to_address,
        amount_wei,
        amount_eth_wei,
        price_eth_per_token,
        side,
        src,
        eth_price_usd
      FROM token_transfers
      WHERE ${whereClause}
      ORDER BY block_time DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `

    params.push(pageSize, offset)
    const { rows: transactions } = await pool.query(transactionsQuery, params)
    
    console.log('📊 Transactions found:', transactions.length)

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
