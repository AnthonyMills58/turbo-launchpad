import { NextRequest, NextResponse } from 'next/server'
import { calculatePortfolio } from '@/lib/calculatePortfolio'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: NextRequest) {
  try {
    const { wallet } = await req.json()
    if (!wallet) {
      return NextResponse.json({ error: 'Missing wallet address' }, { status: 400 })
    }

    const portfolio = await calculatePortfolio(wallet)
    return NextResponse.json(portfolio, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('🔴 Portfolio API Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


