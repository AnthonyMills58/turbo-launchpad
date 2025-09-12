// Cleanup operations for overlapping records
// Extracted from workers/index.ts

import pool from '../../lib/db'
import { providerFor } from '../core/providers'

export async function cleanupOverlappingTransfers(chainId: number) {
  console.log(`\n=== Cleaning up overlapping transfers for chain ${chainId} ===`)
  
  // First, remove all duplicate records except graduation-related records
  // Note: We need to preserve the new graduation format records (BUY, LP_CREATION, LP_DISTRIBUTION, GRADUATION)
  const { rows: duplicateRecords } = await pool.query(
    `SELECT COUNT(*) as count
     FROM public.token_transfers t1
     JOIN (
       SELECT token_id, tx_hash 
       FROM public.token_transfers 
       WHERE chain_id = $1
       GROUP BY token_id, tx_hash 
       HAVING COUNT(*) > 1
     ) t2 ON t1.token_id = t2.token_id AND t1.tx_hash = t2.tx_hash
     WHERE t1.chain_id = $1 
       AND t1.side NOT IN ('GRADUATION', 'LP_CREATION', 'LP_DISTRIBUTION')
       AND NOT EXISTS (
         -- Don't remove records that are part of graduation format (same tx_hash as GRADUATION record)
         SELECT 1 FROM public.token_transfers t3 
         WHERE t3.chain_id = $1 
           AND t3.token_id = t1.token_id 
           AND t3.tx_hash = t1.tx_hash 
           AND t3.side = 'GRADUATION'
       )`,
    [chainId]
  )
  
  const duplicateRecordsCount = parseInt(duplicateRecords[0].count)
  console.log(`Found ${duplicateRecordsCount} duplicate records (excluding graduation format)`)
  
  if (duplicateRecordsCount > 0) {
    const { rowCount: removedDuplicates } = await pool.query(
      `DELETE FROM public.token_transfers 
       WHERE chain_id = $1 
         AND side NOT IN ('GRADUATION', 'LP_CREATION', 'LP_DISTRIBUTION')
         AND (token_id, tx_hash) IN (
           SELECT token_id, tx_hash 
           FROM public.token_transfers 
           WHERE chain_id = $1
           GROUP BY token_id, tx_hash 
           HAVING COUNT(*) > 1
         )
         AND NOT EXISTS (
           -- Don't remove records that are part of graduation format
           SELECT 1 FROM public.token_transfers t3 
           WHERE t3.chain_id = $1 
             AND t3.token_id = token_transfers.token_id 
             AND t3.tx_hash = token_transfers.tx_hash 
             AND t3.side = 'GRADUATION'
         )`,
      [chainId]
    )
    
    console.log(`Removed ${removedDuplicates} duplicate records (preserved graduation format records)`)
  }
  
  // Then, fix timestamps in token_trades (many records have 1970 timestamps that need correction)
  const { rows: wrongTimestampCount } = await pool.query(
    `SELECT COUNT(*) as count
     FROM public.token_trades 
     WHERE chain_id = $1 AND block_time < '1980-01-01'`,
    [chainId]
  )
  
  const wrongTimestampCountNum = parseInt(wrongTimestampCount[0].count)
  console.log(`Found ${wrongTimestampCountNum} records with 1970 timestamps in token_trades`)
  
  if (wrongTimestampCountNum > 0) {
    // Fix timestamps by getting the correct block timestamp from the blockchain
    const { rows: wrongTimestampRecords } = await pool.query(
      `SELECT DISTINCT block_number FROM public.token_trades 
       WHERE chain_id = $1 AND block_time < '1980-01-01'`,
      [chainId]
    )
    
    console.log(`Fixing timestamps for ${wrongTimestampRecords.length} blocks`)
    
    for (const record of wrongTimestampRecords) {
      try {
        const provider = providerFor(chainId)
        const block = await provider.getBlock(record.block_number)
        if (block) {
          const correctTimestamp = new Date(Number(block.timestamp) * 1000)
          
          await pool.query(
            `UPDATE public.token_trades 
             SET block_time = $1 
             WHERE chain_id = $2 AND block_number = $3 AND block_time < '1980-01-01'`,
            [correctTimestamp, chainId, record.block_number]
          )
          
          console.log(`Fixed timestamp for block ${record.block_number}: ${correctTimestamp}`)
        }
      } catch (e) {
        console.warn(`Could not fix timestamp for block ${record.block_number}:`, e)
      }
    }
  }
  
  // Then, clean up any remaining duplicate records in token_trades
  // Look for duplicates with same tx_hash (different log_index, block_number, etc.)
  const { rows: duplicateCount } = await pool.query(
    `SELECT COUNT(*) as count
     FROM public.token_trades t1
     JOIN (
       SELECT tx_hash 
       FROM public.token_trades 
       WHERE chain_id = $1
       GROUP BY tx_hash 
       HAVING COUNT(*) > 1
     ) t2 ON t1.tx_hash = t2.tx_hash
     WHERE t1.chain_id = $1`,
    [chainId]
  )
  
  const duplicateCountNum = parseInt(duplicateCount[0].count)
  console.log(`Found ${duplicateCountNum} duplicate records in token_trades`)
  
  if (duplicateCountNum > 0) {
    // Remove duplicates, keeping the one with the highest log_index
    const { rowCount: removedDuplicates } = await pool.query(
      `DELETE FROM public.token_trades 
       WHERE chain_id = $1 AND (tx_hash, log_index) NOT IN (
         SELECT tx_hash, MAX(log_index) as max_log_index
         FROM public.token_trades 
         WHERE chain_id = $1
         GROUP BY tx_hash
       )`,
      [chainId]
    )
    
    console.log(`Removed ${removedDuplicates} duplicate records from token_trades`)
  }
  
  // Finally, clean up any overlapping records between token_transfers and token_trades
  const { rows: overlappingCount } = await pool.query(
    `SELECT COUNT(*) as count
     FROM public.token_transfers tt
     JOIN public.token_trades tr ON tt.chain_id = tr.chain_id AND tt.tx_hash = tr.tx_hash
     WHERE tt.chain_id = $1`,
    [chainId]
  )
  
  const overlappingCountNum = parseInt(overlappingCount[0].count)
  console.log(`Found ${overlappingCountNum} overlapping records between token_transfers and token_trades`)
  
  if (overlappingCountNum > 0) {
    // Remove overlapping records from token_transfers (keep token_trades)
    const { rowCount: removedOverlapping } = await pool.query(
      `DELETE FROM public.token_transfers 
       WHERE chain_id = $1 AND (chain_id, tx_hash) IN (
         SELECT chain_id, tx_hash FROM public.token_trades WHERE chain_id = $1
       )`,
      [chainId]
    )
    
    console.log(`Removed ${removedOverlapping} overlapping records from token_transfers`)
  }
}
