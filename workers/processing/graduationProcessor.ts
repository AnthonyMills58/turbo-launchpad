// Graduation transaction consolidation
// Extracted from workers/index.ts

import pool from '../../lib/db'

export async function consolidateGraduationTransactions(chainId: number) {
  console.log(`\n=== Consolidating graduation transactions for chain ${chainId} ===`)
  
  // Find existing GRADUATION records that need to be converted to new format
  const { rows: graduationRecords } = await pool.query(
    `SELECT token_id, tx_hash, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, block_number, block_time, contract_address
     FROM public.token_transfers 
     WHERE chain_id = $1 AND side = 'GRADUATION'`,
    [chainId]
  )
  
  console.log(`Found ${graduationRecords.length} existing GRADUATION records to convert`)
  
  for (const graduation of graduationRecords) {
    await convertGraduationToNewFormat(graduation, chainId)
  }
}

async function convertGraduationToNewFormat(
  graduation: { 
    token_id: number; 
    tx_hash: string; 
    from_address: string; 
    to_address: string; 
    amount_wei: string; 
    amount_eth_wei: string; 
    price_eth_per_token: number | null; 
    block_number: number; 
    block_time: Date; 
    contract_address: string;
  },
  chainId: number
) {
  console.log(`Converting graduation: token ${graduation.token_id}, tx ${graduation.tx_hash}`)
  
  // Remove the existing GRADUATION record
  await pool.query(
    `DELETE FROM public.token_transfers 
     WHERE chain_id = $1 AND token_id = $2 AND tx_hash = $3 AND side = 'GRADUATION'`,
    [chainId, graduation.token_id, graduation.tx_hash]
  )
  
  // Insert the new 4-record format
  // Record 1: User BUY (bonding curve operation)
  await pool.query(
    `INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      graduation.token_id, 
      chainId, 
      graduation.contract_address, 
      graduation.block_number, 
      graduation.block_time, 
      graduation.tx_hash, 
      1, // log_index 1 for user BUY
      graduation.from_address, // User who triggered graduation
      graduation.contract_address, // Contract receives tokens
      graduation.amount_wei, 
      graduation.amount_eth_wei, 
      graduation.price_eth_per_token,
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
      graduation.token_id, 
      chainId, 
      graduation.contract_address, 
      graduation.block_number, 
      graduation.block_time, 
      graduation.tx_hash, 
      2, // log_index 2 for LP Creation
      graduation.contract_address, // Contract creates LP
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
      graduation.token_id, 
      chainId, 
      graduation.contract_address, 
      graduation.block_number, 
      graduation.block_time, 
      graduation.tx_hash, 
      3, // log_index 3 for LP Distribution
      '0x0000000000000000000000000000000000000000', // Placeholder for LP pool address
      graduation.contract_address, // Contract receives LP tokens
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
      graduation.token_id, 
      chainId, 
      graduation.contract_address, 
      graduation.block_number, 
      graduation.block_time, 
      graduation.tx_hash, 
      0, // log_index 0 for graduation summary
      graduation.contract_address, // Contract
      graduation.contract_address, // Contract (graduation target)
      graduation.amount_wei, 
      graduation.amount_eth_wei, 
      graduation.price_eth_per_token,
      'GRADUATION',
      'BC', // Bonding curve operation
      JSON.stringify({
        type: 'graduation',
        phase: 'summary',
        total_tokens: graduation.amount_wei,
        total_eth: graduation.amount_eth_wei,
        price_eth_per_token: graduation.price_eth_per_token,
        graduation_trigger: graduation.from_address,
        lp_address: null, // Will be populated when DEX pool is discovered
        reserves: null // Will be populated when DEX pool is processed
      })
    ]
  )
  
  console.log(`Converted graduation to new format: User BUY, LP Creation, LP Distribution, Graduation Summary`)
}

