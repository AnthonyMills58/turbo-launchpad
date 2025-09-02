import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    // Get all media assets and variants
    const result = await pool.query(`
      SELECT 
        ma.id as asset_id,
        ma.kind,
        ma.owner_wallet,
        ma.sha256,
        ma.created_at,
        mv.variant,
        mv.width,
        mv.height,
        mv.mime,
        mv.size,
        mv.bytes IS NOT NULL as has_bytes
      FROM media_assets ma
      LEFT JOIN media_variants mv ON ma.id = mv.asset_id
      WHERE ma.deleted_at IS NULL
      ORDER BY ma.id, mv.variant
    `)

    return NextResponse.json({
      success: true,
      data: result.rows
    })

  } catch (error) {
    console.error('Debug media error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}
