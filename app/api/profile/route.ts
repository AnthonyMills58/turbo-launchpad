import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const wallet = searchParams.get('wallet')
    
    console.log('🔍 Profile API GET request for wallet:', wallet)
    
    if (!wallet) {
      return NextResponse.json({ success: false, error: 'Wallet address is required' }, { status: 400 })
    }

    const result = await db.query(
      'SELECT wallet, display_name, bio, avatar_asset_id FROM profiles WHERE LOWER(wallet) = LOWER($1)',
      [wallet]
    )

    console.log('🔍 Database query result:', result.rows)

    if (result.rows.length === 0) {
      console.log('🔍 No profile found for wallet:', wallet)
      return NextResponse.json({ success: true, profile: null })
    }

    const profile = result.rows[0]
    console.log('🔍 Profile found:', profile)
    
    // Check if media asset exists
    if (profile.avatar_asset_id) {
      const mediaResult = await db.query(
        'SELECT id, kind, original_mime FROM media_assets WHERE id = $1 AND deleted_at IS NULL',
        [profile.avatar_asset_id]
      )
      console.log('🔍 Media asset check:', mediaResult.rows)
      
      // Check if media variants exist
      if (mediaResult.rows.length > 0) {
        const variantsResult = await db.query(
          'SELECT variant, mime, size FROM media_variants WHERE asset_id = $1',
          [profile.avatar_asset_id]
        )
        console.log('🔍 Media variants check:', variantsResult.rows)
        
        // If no variants exist, this is an orphaned asset
        if (variantsResult.rows.length === 0) {
          console.log('🔍 WARNING: Orphaned media asset found - no variants exist')
          // Clean up the orphaned asset and profile reference
          await db.query('UPDATE profiles SET avatar_asset_id = NULL WHERE wallet = $1', [wallet])
          await db.query('DELETE FROM media_assets WHERE id = $1', [profile.avatar_asset_id])
          console.log('🔍 Cleaned up orphaned media asset')
          
          // Return profile without avatar
          profile.avatar_asset_id = null
        }
      } else {
        console.log('🔍 WARNING: Media asset not found - cleaning up profile reference')
        // Clean up the invalid profile reference
        await db.query('UPDATE profiles SET avatar_asset_id = NULL WHERE wallet = $1', [wallet])
        profile.avatar_asset_id = null
      }
    }
    
    return NextResponse.json({ success: true, profile })
  } catch (error) {
    console.error('🔍 Failed to fetch profile:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch profile' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { wallet, displayName, bio, avatarAssetId } = await request.json()
    
    console.log('🔍 Profile API POST request:', { wallet, displayName, bio, avatarAssetId })
    
    if (!wallet) {
      return NextResponse.json({ success: false, error: 'Wallet address is required' }, { status: 400 })
    }

    // Upsert profile (insert if not exists, update if exists)
    const result = await db.query(
      `INSERT INTO profiles (wallet, display_name, bio, avatar_asset_id) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (wallet) 
       DO UPDATE SET 
         display_name = EXCLUDED.display_name, 
         bio = EXCLUDED.bio, 
         avatar_asset_id = EXCLUDED.avatar_asset_id
       RETURNING wallet, display_name, bio, avatar_asset_id`,
      [wallet, displayName || null, bio || null, avatarAssetId || null]
    )

    const profile = result.rows[0]
    console.log('🔍 Profile saved successfully:', profile)
    return NextResponse.json({ success: true, profile })
  } catch (error) {
    console.error('🔍 Failed to save profile:', error)
    return NextResponse.json({ success: false, error: 'Failed to save profile' }, { status: 500 })
  }
}
