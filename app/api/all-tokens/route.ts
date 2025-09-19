import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const search = searchParams.get('search') || ''
  const creatorFilter = searchParams.get('creator') || 'all'
  const statusFilter = searchParams.get('status') || 'all'
  const sortFilter = searchParams.get('sort') || 'created_desc'
  const chainId = searchParams.get('chainId')
  
  // Pagination parameters
  const page = parseInt(searchParams.get('page') || '1')
  const pageSize = parseInt(searchParams.get('pageSize') || '12')
  const offset = (page - 1) * pageSize

  const values: (string | number | boolean | null)[] = []
  const conditions: string[] = ['contract_address IS NOT NULL']

  // ✅ Optional chain ID filter
  if (chainId) {
    values.push(Number(chainId))
    conditions.push(`chain_id = $${values.length}`)
  }

  // ✅ Search filter
  if (search) {
    values.push(`%${search.toLowerCase()}%`)
    conditions.push(`
      (LOWER(name) LIKE $${values.length}
      OR LOWER(symbol) LIKE $${values.length}
      OR LOWER(contract_address) LIKE $${values.length}
      OR LOWER(creator_wallet) LIKE $${values.length})
    `)
  }

  // ✅ Creator filter
  if (creatorFilter === 'mine' || creatorFilter === 'others') {
    const isMine = creatorFilter === 'mine'
    const userAddress = searchParams.get('address')?.toLowerCase() || ''
    if (userAddress) {
      values.push(userAddress)
      conditions.push(
        `LOWER(creator_wallet) ${isMine ? '=' : '!='} $${values.length}`
      )
    }
  }

  // ✅ Status filter
  if (statusFilter === 'in_progress') {
    conditions.push('is_graduated = false AND on_dex = false')
  } else if (statusFilter === 'graduated') {
    conditions.push('is_graduated = true')
  } else if (statusFilter === 'on_dex') {
    conditions.push('on_dex = true')
  }

  // ✅ Sorting
  let orderClause = 'ORDER BY id DESC'
  if (sortFilter === 'created_asc') orderClause = 'ORDER BY id ASC'
  if (sortFilter === 'name') orderClause = 'ORDER BY name ASC'
  if (sortFilter === 'symbol') orderClause = 'ORDER BY symbol ASC'

  // First, get total count
  const countQuery = `
    SELECT COUNT(*) as total FROM tokens
    WHERE ${conditions.join(' AND ')}
  `

  // Then get paginated results
  const dataQuery = `
    SELECT * FROM tokens
    WHERE ${conditions.join(' AND ')}
    ${orderClause}
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `

  try {
    // Get total count
    const countResult = await pool.query(countQuery, values)
    const totalCount = parseInt(countResult.rows[0].total)
    const totalPages = Math.ceil(totalCount / pageSize)

    // Get paginated data
    const dataValues = [...values, pageSize, offset]
    const dataResult = await pool.query(dataQuery, dataValues)

    return NextResponse.json({
      tokens: dataResult.rows,
      totalCount,
      totalPages,
      currentPage: page,
      pageSize
    })
  } catch (err) {
    console.error('Error fetching filtered tokens:', err)
    return new NextResponse('Failed to fetch tokens', { status: 500 })
  }
}



