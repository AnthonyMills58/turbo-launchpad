// /app/api/eth-price/route.ts
import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET() {
  try {
    //console.log('[API] GET /api/eth-price');
    const result = await pool.query(
      `SELECT price_usd FROM eth_price_cache WHERE id=1`
    );
    const latest = result.rows[0]?.price_usd || null;
    //console.log('[API] Returning ETH price from DB:', latest);
    return NextResponse.json({ price: latest });
  } catch (error) {
    console.error('[API] Error fetching ETH price from DB:', error);
    return NextResponse.json({ price: null }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    //console.log('[API] POST /api/eth-price');
    const { price } = await req.json();
   // console.log('[API] Received price to save:', price);

    if (typeof price !== 'number' || isNaN(price)) {
      //console.warn('[API] Invalid price payload');
      return NextResponse.json({ error: 'Invalid price' }, { status: 400 });
    }

    await pool.query(
      `INSERT INTO eth_price_cache (id, price_usd, fetched_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE
       SET price_usd = EXCLUDED.price_usd,
           fetched_at = NOW()`,
      [price]
    );

    //console.log('[API] ETH price saved successfully');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Error saving ETH price:', error);
    return NextResponse.json({ error: 'Failed to save price' }, { status: 500 });
  }
}
