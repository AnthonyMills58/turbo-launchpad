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
      WITH recent_transactions AS (
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
          tt.side, 
          amount_eth_wei * eth_price_usd / 1e18 as value, 
          tt.block_time, 
          tt.log_index,
          tt.price_eth_per_token * eth_price_usd as price_usd_per_token
          from token_transfers tt 
          join tokens t on tt.token_id = t.id
          where SIDE <> 'MINT' 
            and tt.chain_id = $1
        union
        select id, symbol, image, token_logo_asset_id, contract_address, creator_wallet, 'LAUNCH', 0, created_at, 0, NULL
        from tokens 
        where chain_id = $1
        ) op
        left join profiles p on lower(op.trader)= lower(p.wallet)
        ORDER BY block_time DESC, log_index DESC
        LIMIT 20
      ),
      price_24h_data AS (
        SELECT 
          rt.*,
          -- Get the most recent transaction older than 24h before THIS transaction's time
          (
            SELECT tt2.price_eth_per_token * tt2.eth_price_usd
            FROM token_transfers tt2
            WHERE tt2.token_id = rt.id 
              AND tt2.chain_id = $1
              AND tt2.block_time < rt.block_time - INTERVAL '24 hours'
              AND tt2.price_eth_per_token IS NOT NULL 
              AND tt2.price_eth_per_token > 0
            ORDER BY tt2.block_time DESC, tt2.log_index DESC
            LIMIT 1
          ) as price_24h_ago
        FROM recent_transactions rt
      )
      SELECT 
        id, symbol, image, token_logo_asset_id, contract_address, trader, side, value, 
        block_time, log_index, trader_name, price_usd_per_token, price_24h_ago,
        -- Calculate price change vs 24h ago only if both prices exist
        CASE 
          WHEN price_usd_per_token IS NOT NULL 
            AND price_usd_per_token > 0
            AND price_24h_ago IS NOT NULL 
            AND price_24h_ago > 0
          THEN 
            ((price_usd_per_token - price_24h_ago) / price_24h_ago) * 100
          ELSE NULL
        END as price_change_pct
      FROM price_24h_data
      ORDER BY block_time DESC, log_index DESC
    `

    const result = await db.query(query, [chainId])
    
    // Ensure all numeric fields are properly converted
    const processedTransactions = result.rows.map(row => ({
      ...row,
      price_eth_per_token: row.price_eth_per_token ? parseFloat(row.price_eth_per_token) : null,
      price_change_pct: row.price_change_pct ? parseFloat(row.price_change_pct) : null,
      value: row.value ? parseFloat(row.value) : null
    }))
    
    return NextResponse.json({ 
      success: true, 
      transactions: processedTransactions 
    })

  } catch (error) {
    console.error('Error fetching newest transactions:', error)
    return NextResponse.json({ 
      error: 'Failed to fetch transactions' 
    }, { status: 500 })
  }
}
