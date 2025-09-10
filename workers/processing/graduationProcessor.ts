// Graduation transaction consolidation
// Extracted from workers/index.ts

import pool from '../../lib/db'

export async function consolidateGraduationTransactions(chainId: number) {
  console.log(`\n=== Consolidating graduation transactions for chain ${chainId} ===`)
  
  // Find graduation candidates from token_transfers (transactions with multiple records)
  const { rows: transferCandidates } = await pool.query(
    `SELECT token_id, tx_hash, COUNT(*) as count
     FROM public.token_transfers 
     WHERE chain_id = $1
     GROUP BY token_id, tx_hash
     HAVING COUNT(*) > 1`,
    [chainId]
  )
  
  console.log(`Found ${transferCandidates.length} graduation candidates in token_transfers`)
  
  for (const candidate of transferCandidates) {
    await consolidateGraduationCandidate(candidate, chainId, 'transfers')
  }
  
  // Find graduation candidates from token_trades (transactions with multiple records)
  const { rows: tradeCandidates } = await pool.query(
    `SELECT token_id, tx_hash, COUNT(*) as count
     FROM public.token_trades 
     WHERE chain_id = $1
     GROUP BY token_id, tx_hash
     HAVING COUNT(*) > 1`,
    [chainId]
  )
  
  console.log(`Found ${tradeCandidates.length} graduation candidates in token_trades`)
  
  for (const candidate of tradeCandidates) {
    await consolidateGraduationCandidate(candidate, chainId, 'trades')
  }
}

async function consolidateGraduationCandidate(
  candidate: { token_id: number; tx_hash: string; count: number },
  chainId: number,
  source: 'transfers' | 'trades'
) {
  console.log(`Consolidating graduation: token ${candidate.token_id}, tx ${candidate.tx_hash}, source: ${source}`)
  
  if (source === 'transfers') {
    await consolidateFromTransfers(candidate, chainId)
  } else {
    await consolidateFromTrades(candidate, chainId)
  }
}

async function consolidateFromTransfers(
  candidate: { token_id: number; tx_hash: string },
  chainId: number
) {
  // Get all transfer records for this transaction
  const { rows: transfers } = await pool.query(
    `SELECT * FROM public.token_transfers 
     WHERE chain_id = $1 AND token_id = $2 AND tx_hash = $3
     ORDER BY log_index ASC`,
    [chainId, candidate.token_id, candidate.tx_hash]
  )
  
  if (transfers.length === 0) return
  
  const firstTransfer = transfers[0]
  const totalTokens = transfers.reduce((sum, t) => sum + BigInt(t.amount_wei), 0n)
  const totalEthWei = transfers.reduce((sum, t) => sum + BigInt(t.amount_eth_wei || '0'), 0n)
  const priceEthPerToken = totalEthWei > 0n ? Number(totalEthWei) / Number(totalTokens) : null
  
  // Remove ALL records with same tx_hash (including UNLOCK records)
  // Then insert only the GRADUATION record
  await pool.query(
    `DELETE FROM public.token_transfers 
     WHERE chain_id = $1 AND tx_hash = $2`,
    [chainId, candidate.tx_hash]
  )
  
  // Now insert the GRADUATION record
  await pool.query(
    `INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      candidate.token_id, 
      chainId, 
      firstTransfer.contract_address, 
      firstTransfer.block_number, 
      firstTransfer.block_time, 
      candidate.tx_hash, 
      0, // Use log_index 0 for consolidated record
      firstTransfer.from_address, 
      firstTransfer.contract_address, // To contract (graduation target)
      totalTokens.toString(), 
      totalEthWei.toString(), 
      priceEthPerToken, // Calculated price in ETH
      'GRADUATION'
    ]
  )
  
  console.log(`Consolidated ${transfers.length} transfer records into single GRADUATION record`)
}

async function consolidateFromTrades(
  candidate: { token_id: number; tx_hash: string },
  chainId: number
) {
  // Get all trade records for this transaction
  const { rows: trades } = await pool.query(
    `SELECT * FROM public.token_trades 
     WHERE chain_id = $1 AND token_id = $2 AND tx_hash = $3
     ORDER BY log_index ASC`,
    [chainId, candidate.token_id, candidate.tx_hash]
  )
  
  if (trades.length === 0) return
  
  const firstTrade = trades[0]
  
  // Get token contract address
  const { rows: tokenRows } = await pool.query(
    'SELECT contract_address FROM public.tokens WHERE id = $1',
    [candidate.token_id]
  )
  
  if (tokenRows.length === 0) return
  
  const contractAddress = tokenRows[0].contract_address
  
  // Remove ALL trade records for this transaction
  await pool.query(
    `DELETE FROM public.token_trades 
     WHERE chain_id = $1 AND tx_hash = $2`,
    [chainId, candidate.tx_hash]
  )
  
  // Insert single GRADUATION record into token_transfers
  await pool.query(
    `INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      candidate.token_id, 
      chainId, 
      contractAddress, 
      firstTrade.block_number, 
      firstTrade.block_time, 
      candidate.tx_hash, 
      0, // Use log_index 0 for consolidated record
      firstTrade.trader, 
      contractAddress, // To contract (graduation target)
      firstTrade.amount_token_wei, 
      firstTrade.amount_eth_wei, 
      firstTrade.price_eth_per_token, 
      'GRADUATION'
    ]
  )
  
  console.log(`Consolidated ${trades.length} trade records into single GRADUATION record`)
}
