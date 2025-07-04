import { NextResponse } from 'next/server'
import { getTokenOnChainData } from '@/lib/contractReader' // <- your Moralis or read contract logic
import pool from '@/lib/db'

export async function POST(req: Request) {
  try {
    const { contractAddress } = await req.json()

    const onChainData = await getTokenOnChainData(contractAddress) // <- must include `graduated`, `totalRaised`

    await pool.query(
      `UPDATE tokens
       SET is_graduated = $1, eth_raised = $2, updated_at = NOW()
       WHERE contract_address = $3`,
      [onChainData.graduated, onChainData.totalRaised, contractAddress]
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error updating token:', err)
    return NextResponse.json({ success: false, error: 'Update failed' }, { status: 500 })
  }
}
