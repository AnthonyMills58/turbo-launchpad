import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function POST(req: Request) {
  try {
    const { contractAddress, chainId, graduated, totalRaised } = await req.json()

    if (!contractAddress || !chainId) {
      return NextResponse.json({ error: 'Missing contractAddress or chainId' }, { status: 400 })
    }

    await pool.query(
      `UPDATE tokens
       SET is_graduated = $1, eth_raised = $2, updated_at = NOW()
       WHERE contract_address = $3`,
      [graduated, totalRaised, contractAddress]
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error updating token:', err)
    return NextResponse.json({ success: false, error: 'Update failed' }, { status: 500 })
  }
}


