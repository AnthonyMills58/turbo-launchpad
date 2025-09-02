import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'
import {
  sniffMime,
  sha256Hex,
  normalizeOriginal,
  makeThumbnail,
  validateFileSize,
  validateMimeType,
  MEDIA_CONSTANTS,
  MEDIA_VARIANTS
} from '@/lib/media'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    
    const formData = await request.formData()
    const file = formData.get('file') as File
    const kind = formData.get('kind') as string
    const ownerWallet = formData.get('ownerWallet') as string
    
    // Validation
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    
    if (!kind || !['token_logo', 'avatar', 'other'].includes(kind)) {
      return NextResponse.json({ error: 'Invalid media kind' }, { status: 400 })
    }
    
    if (!ownerWallet || !/^0x[a-fA-F0-9]{40}$/.test(ownerWallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }
    
    // File size validation
    if (!validateFileSize(file.size)) {
      return NextResponse.json({ 
        error: `File too large. Maximum size is ${MEDIA_CONSTANTS.MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB` 
      }, { status: 400 })
    }
    
    // Convert file to buffer
    const buffer = Buffer.from(await file.arrayBuffer())
    
    // MIME type detection and validation
    let mimeType: string
    try {
      mimeType = sniffMime(buffer)
    } catch {
      return NextResponse.json({ error: 'Unsupported file format' }, { status: 400 })
    }
    
    if (!validateMimeType(mimeType)) {
      return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
    }
    
    // Generate SHA256 hash
    const sha256Hash = sha256Hex(buffer)
    
    // Check if asset already exists
    const existingAsset = await pool.query(
      'SELECT id FROM media_assets WHERE sha256 = $1 AND deleted_at IS NULL',
      [sha256Hash]
    )
    
    let assetId: string
    
    if (existingAsset.rows.length > 0) {
      // Asset already exists, use existing ID
      assetId = existingAsset.rows[0].id
      
      // Update owner if different
      await pool.query(
        'UPDATE media_assets SET owner_wallet = $1 WHERE id = $2',
        [ownerWallet.toLowerCase(), assetId]
      )
    } else {
            // Process original image
      const { buffer: normalizedBuffer, width, height } = await normalizeOriginal(buffer)

      // Create thumbnail
      const { buffer: thumbnailBuffer, width: thumbWidth, height: thumbHeight } = await makeThumbnail(normalizedBuffer)
      
      // Insert new asset
      const assetResult = await pool.query(
        `INSERT INTO media_assets (
          kind, owner_wallet, sha256, original_mime, original_size, 
          original_width, original_height
        ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          kind,
          ownerWallet.toLowerCase(),
          sha256Hash,
          mimeType,
          file.size,
          width,
          height
        ]
      )
      
      assetId = assetResult.rows[0].id
      
      // Insert variants with bytes stored directly in database
      await pool.query(
        `INSERT INTO media_variants (
          asset_id, variant, mime, size, width, height, bytes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7), ($8, $9, $10, $11, $12, $13, $14)`,
        [
          assetId, MEDIA_VARIANTS.ORIGINAL, 'image/webp', normalizedBuffer.length, width, height, normalizedBuffer,
          assetId, MEDIA_VARIANTS.THUMBNAIL, 'image/webp', thumbnailBuffer.length, thumbWidth, thumbHeight, thumbnailBuffer
        ]
      )
    }
    
    // Return success response
    return NextResponse.json({
      assetId,
      urlThumb: `/api/media/${assetId}?v=thumb`,
      urlOrig: `/api/media/${assetId}?v=orig`
    })
    
  } catch (error) {
    console.error('Media upload error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
