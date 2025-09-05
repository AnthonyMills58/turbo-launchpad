import { NextResponse } from 'next/server'
import db from '@/lib/db'

export async function POST() {
  try {
    
    // Find orphaned media assets (assets without variants)
    const orphanedAssets = await db.query(`
      SELECT ma.id, ma.kind, ma.owner_wallet 
      FROM media_assets ma 
      LEFT JOIN media_variants mv ON ma.id = mv.asset_id 
      WHERE mv.asset_id IS NULL 
      AND ma.deleted_at IS NULL
    `)
    
    console.log('🔍 Found orphaned assets:', orphanedAssets.rows)
    
    if (orphanedAssets.rows.length > 0) {
      // Clean up profiles that reference orphaned assets
      for (const asset of orphanedAssets.rows) {
        await db.query('UPDATE profiles SET avatar_asset_id = NULL WHERE avatar_asset_id = $1', [asset.id])
      }
      
      // Clean up tokens that reference orphaned assets
      await db.query('UPDATE tokens SET token_logo_asset_id = NULL WHERE token_logo_asset_id = ANY($1)', 
        [orphanedAssets.rows.map(a => a.id)])
      
      // Delete orphaned media assets
      await db.query('DELETE FROM media_assets WHERE id = ANY($1)', 
        [orphanedAssets.rows.map(a => a.id)])
    }
    
    return NextResponse.json({ 
      success: true, 
      message: `Cleaned up ${orphanedAssets.rows.length} orphaned media assets` 
    })
  } catch (error) {
    console.error('🔍 Failed to cleanup media:', error)
    return NextResponse.json({ success: false, error: 'Failed to cleanup media' }, { status: 500 })
  }
}
