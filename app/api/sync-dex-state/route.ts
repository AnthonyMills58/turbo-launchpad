import { NextRequest, NextResponse } from 'next/server'
import { syncDexState } from '@/lib/syncDexState'
import { Token } from '@/types/token'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, chainId } = body

    if (!token || !chainId) {
      return NextResponse.json({ error: 'Missing token or chainId' }, { status: 400 })
    }

    // Create a mock onRefresh function since we don't need to refresh the client
    const mockOnRefresh = () => {
      console.log('[API] syncDexState completed, client should refresh')
    }

    // Call the syncDexState function server-side
    await syncDexState(token as Token, chainId, mockOnRefresh)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API] syncDexState error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
