import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const chainId = searchParams.get('chainId')

    if (!chainId) {
      return NextResponse.json({ error: 'Chain ID is required' }, { status: 400 })
    }

    const query = `
      select op.*, p.display_name as trader_name from
      (
        select t.id, t.symbol, t.image, t.token_logo_asset_id, tt.contract_address,
        (
          case tt.side
            when 'BUY&LOCK' then t.creator_wallet
            when 'BUY' then to_address
            when 'CLAIMAIRDROP' then to_address
            when 'UNLOCK' then to_address
            when 'SELL' then from_address
            when 'GRADUATION' then to_address
          end
        ) trader,
        tt.side, amount_eth_wei * eth_price_usd / 1e18 as value, tt.block_time, tt.log_index 
        from token_transfers tt 
        join tokens t on tt.token_id = t.id
        where SIDE <> 'MINT' and tt.chain_id = $1
        union
        select id, symbol, image, token_logo_asset_id, contract_address, creator_wallet, 'LAUNCH', 0, created_at, 0  
        from tokens 
        where chain_id = $1
      ) op
      left join profiles p on lower(op.trader)= lower(p.wallet)
      order by block_time desc, log_index asc 
      limit 20
    `

    const result = await db.query(query, [chainId])
    
    return NextResponse.json({ 
      success: true, 
      transactions: result.rows 
    })

  } catch (error) {
    console.error('Error fetching newest transactions:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch transactions' 
    }, { status: 500 })
  }
}
