import { NextRequest, NextResponse } from 'next/server'
import { syncTokenState } from '@/lib/syncTokensState'


export async function POST(req: NextRequest) {
  try {
    const { tokenId, contractAddress, chainId, txHash, operationType } = await req.json()
    
    console.log(`[API /sync] Received sync request: tokenId=${tokenId}, contractAddress=${contractAddress}, chainId=${chainId}, txHash=${txHash}, operationType=${operationType}`)
    console.log(`[API /sync] Parameters:`, { tokenId, contractAddress, chainId, txHash, operationType })

    if (!tokenId || !contractAddress || !chainId) {
      console.log(`[API /sync] Missing required fields`)
      return NextResponse.json(
        { error: 'Missing tokenId, contractAddress, or chainId' },
        { status: 400 }
      )
    }

    console.log(`[API /sync] Calling syncTokenState...`)
    await syncTokenState(contractAddress, tokenId, chainId, txHash, operationType)
    console.log(`[API /sync] ✅ syncTokenState completed successfully for token ${tokenId}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API /sync] Error syncing token:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


