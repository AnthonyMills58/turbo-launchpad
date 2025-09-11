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
  await pool.query(
    `DELETE FROM public.token_transfers 
     WHERE chain_id = $1 AND tx_hash = $2`,
    [chainId, candidate.tx_hash]
  )
  
  // NEW GRADUATION LOGIC: Insert multiple records instead of single GRADUATION
  // Record 1: User BUY (bonding curve operation)
  await pool.query(
    `INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      candidate.token_id, 
      chainId, 
      firstTransfer.contract_address, 
      firstTransfer.block_number, 
      firstTransfer.block_time, 
      candidate.tx_hash, 
      1, // log_index 1 for user BUY
      firstTransfer.from_address, // User who triggered graduation
      firstTransfer.contract_address, // Contract receives tokens
      totalTokens.toString(), 
      totalEthWei.toString(), 
      priceEthPerToken,
      'BUY',
      'BC' // Bonding curve operation
    ]
  )
  
  // Record 2: LP Creation (DEX operation) - will be populated when DEX pool is discovered
  await pool.query(
    `INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, graduation_metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      candidate.token_id, 
      chainId, 
      firstTransfer.contract_address, 
      firstTransfer.block_number, 
      firstTransfer.block_time, 
      candidate.tx_hash, 
      2, // log_index 2 for LP Creation
      firstTransfer.contract_address, // Contract creates LP
      '0x0000000000000000000000000000000000000000', // Placeholder for LP pool address
      '0', // No token amount for LP creation
      '0', // No ETH amount for LP creation
      null, // No price for LP creation
      'LP_CREATION',
      'DEX', // DEX operation
      JSON.stringify({
        type: 'graduation',
        phase: 'lp_creation',
        reserves: null, // Will be populated when DEX pool is processed
        lp_address: null // Will be populated when DEX pool is discovered
      })
    ]
  )
  
  // Record 3: LP Distribution (DEX operation) - will be populated when DEX pool is processed
  await pool.query(
    `INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, graduation_metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      candidate.token_id, 
      chainId, 
      firstTransfer.contract_address, 
      firstTransfer.block_number, 
      firstTransfer.block_time, 
      candidate.tx_hash, 
      3, // log_index 3 for LP Distribution
      '0x0000000000000000000000000000000000000000', // Placeholder for LP pool address
      firstTransfer.contract_address, // Contract receives LP tokens
      '0', // No token amount for LP distribution
      '0', // No ETH amount for LP distribution
      null, // No price for LP distribution
      'LP_DISTRIBUTION',
      'DEX', // DEX operation
      JSON.stringify({
        type: 'graduation',
        phase: 'lp_distribution',
        creator_share: null, // Will be populated when DEX pool is processed
        platform_share: null, // Will be populated when DEX pool is processed
        lp_address: null // Will be populated when DEX pool is discovered
      })
    ]
  )
  
  // Record 4: Graduation metadata (summary record)
  await pool.query(
    `INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, graduation_metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      candidate.token_id, 
      chainId, 
      firstTransfer.contract_address, 
      firstTransfer.block_number, 
      firstTransfer.block_time, 
      candidate.tx_hash, 
      0, // log_index 0 for graduation summary
      firstTransfer.contract_address, // Contract
      firstTransfer.contract_address, // Contract (graduation target)
      totalTokens.toString(), 
      totalEthWei.toString(), 
      priceEthPerToken,
      'GRADUATION',
      'BC', // Bonding curve operation
      JSON.stringify({
        type: 'graduation',
        phase: 'summary',
        total_tokens: totalTokens.toString(),
        total_eth: totalEthWei.toString(),
        price_eth_per_token: priceEthPerToken,
        graduation_trigger: firstTransfer.from_address,
        lp_address: null, // Will be populated when DEX pool is discovered
        reserves: null // Will be populated when DEX pool is processed
      })
    ]
  )
  
  console.log(`Created new graduation records: User BUY, LP Creation, LP Distribution, Graduation Summary`)
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
  
  // NEW GRADUATION LOGIC: Insert multiple records instead of single GRADUATION
  // Record 1: User BUY (bonding curve operation)
  await pool.query(
    `INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      candidate.token_id, 
      chainId, 
      contractAddress, 
      firstTrade.block_number, 
      firstTrade.block_time, 
      candidate.tx_hash, 
      1, // log_index 1 for user BUY
      firstTrade.trader, // User who triggered graduation
      contractAddress, // Contract receives tokens
      firstTrade.amount_token_wei, 
      firstTrade.amount_eth_wei, 
      firstTrade.price_eth_per_token, 
      'BUY',
      'BC' // Bonding curve operation
    ]
  )
  
  // Record 2: LP Creation (DEX operation) - will be populated when DEX pool is discovered
  await pool.query(
    `INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, graduation_metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      candidate.token_id, 
      chainId, 
      contractAddress, 
      firstTrade.block_number, 
      firstTrade.block_time, 
      candidate.tx_hash, 
      2, // log_index 2 for LP Creation
      contractAddress, // Contract creates LP
      '0x0000000000000000000000000000000000000000', // Placeholder for LP pool address
      '0', // No token amount for LP creation
      '0', // No ETH amount for LP creation
      null, // No price for LP creation
      'LP_CREATION',
      'DEX', // DEX operation
      JSON.stringify({
        type: 'graduation',
        phase: 'lp_creation',
        reserves: null, // Will be populated when DEX pool is processed
        lp_address: null // Will be populated when DEX pool is discovered
      })
    ]
  )
  
  // Record 3: LP Distribution (DEX operation) - will be populated when DEX pool is processed
  await pool.query(
    `INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, graduation_metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      candidate.token_id, 
      chainId, 
      contractAddress, 
      firstTrade.block_number, 
      firstTrade.block_time, 
      candidate.tx_hash, 
      3, // log_index 3 for LP Distribution
      '0x0000000000000000000000000000000000000000', // Placeholder for LP pool address
      contractAddress, // Contract receives LP tokens
      '0', // No token amount for LP distribution
      '0', // No ETH amount for LP distribution
      null, // No price for LP distribution
      'LP_DISTRIBUTION',
      'DEX', // DEX operation
      JSON.stringify({
        type: 'graduation',
        phase: 'lp_distribution',
        creator_share: null, // Will be populated when DEX pool is processed
        platform_share: null, // Will be populated when DEX pool is processed
        lp_address: null // Will be populated when DEX pool is discovered
      })
    ]
  )
  
  // Record 4: Graduation metadata (summary record)
  await pool.query(
    `INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, graduation_metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      candidate.token_id, 
      chainId, 
      contractAddress, 
      firstTrade.block_number, 
      firstTrade.block_time, 
      candidate.tx_hash, 
      0, // log_index 0 for graduation summary
      contractAddress, // Contract
      contractAddress, // Contract (graduation target)
      firstTrade.amount_token_wei, 
      firstTrade.amount_eth_wei, 
      firstTrade.price_eth_per_token,
      'GRADUATION',
      'BC', // Bonding curve operation
      JSON.stringify({
        type: 'graduation',
        phase: 'summary',
        total_tokens: firstTrade.amount_token_wei,
        total_eth: firstTrade.amount_eth_wei,
        price_eth_per_token: firstTrade.price_eth_per_token,
        graduation_trigger: firstTrade.trader,
        lp_address: null, // Will be populated when DEX pool is discovered
        reserves: null // Will be populated when DEX pool is processed
      })
    ]
  )
  
  console.log(`Created new graduation records: User BUY, LP Creation, LP Distribution, Graduation Summary`)
}
