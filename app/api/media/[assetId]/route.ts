import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import { MEDIA_VARIANTS } from '@/lib/media'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await params
    const { searchParams } = new URL(request.url)
    const variant = searchParams.get('v') || 'thumb' // default to thumbnail
    
    if (!['thumb', 'orig'].includes(variant)) {
      return NextResponse.json({ error: 'Invalid variant' }, { status: 400 })
    }
    
    // Get asset and variant info from database
    const assetResult = await pool.query(
      `SELECT ma.*, mv.mime, mv.size, mv.width, mv.height, mv.bytes
       FROM media_assets ma
       JOIN media_variants mv ON ma.id = mv.asset_id
       WHERE ma.id = $1 AND mv.variant = $2 AND ma.deleted_at IS NULL`,
      [assetId, variant === 'thumb' ? MEDIA_VARIANTS.THUMBNAIL : MEDIA_VARIANTS.ORIGINAL]
    )
    
    if (assetResult.rows.length === 0) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }
    
    const asset = assetResult.rows[0]
    
    // Check if asset is deleted
    if (asset.deleted_at) {
      return NextResponse.json({ error: 'Asset deleted' }, { status: 410 })
    }
    
    // Get bytes directly from database
    const fileBuffer = asset.bytes
    
    // Generate ETag
    const etag = `"${asset.sha256}-${variant}"`
    
    // Check if client has cached version
    const ifNoneMatch = request.headers.get('if-none-match')
    if (ifNoneMatch === etag) {
      return new NextResponse(null, { status: 304 })
    }
    
    // Set response headers
    const headers = new Headers()
    headers.set('Content-Type', asset.mime)
    headers.set('Content-Length', asset.size.toString())
    headers.set('ETag', etag)
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    
    // Return file with headers
    return new NextResponse(fileBuffer, {
      status: 200,
      headers
    })
    
  } catch (error) {
    console.error('Media retrieval error:', error)
    return NextResponse.json({ error: 'Failed to retrieve media' }, { status: 500 })
  }
}
