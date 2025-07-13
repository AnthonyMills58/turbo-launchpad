import { NextRequest, NextResponse } from 'next/server'
import { syncTokenState } from '@/lib/syncTokensState'


export async function POST(req: NextRequest) {
  try {
    const { tokenId, contractAddress, chainId } = await req.json()

    if (!tokenId || !contractAddress || !chainId) {
      return NextResponse.json(
        { error: 'Missing tokenId, contractAddress, or chainId' },
        { status: 400 }
      )
    }

    await syncTokenState(contractAddress, tokenId, chainId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error syncing token:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


