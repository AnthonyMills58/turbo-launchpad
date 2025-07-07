import { NextRequest, NextResponse } from 'next/server'
import { syncTokenState } from '@/lib/syncTokensState'

export async function POST(req: NextRequest) {
  try {
    const { tokenId, contractAddress } = await req.json()

    if (!tokenId || !contractAddress) {
      return NextResponse.json({ error: 'Missing tokenId or contractAddress' }, { status: 400 })
    }

    await syncTokenState(contractAddress, tokenId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error syncing token:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
