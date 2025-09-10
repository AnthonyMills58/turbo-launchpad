// DEX operations processing
// Extracted from workers/index.ts

import { ethers } from 'ethers'
import pool from '../../lib/db'
import { sleep, isRateLimit } from '../core/rateLimiting'

export async function moveDexTradesToCorrectTable(
  tradeRows: Array<{
    token_id: number
    tx_hash: string
    log_index: number
    side: string
    amount_wei: string
    amount_eth_wei: string
    price_eth_per_token: number
    block_number: number
    block_time: Date
  }>,
  chainId: number,
  provider: ethers.JsonRpcProvider
) {
  console.log(`\n=== Moving ${tradeRows.length} BUY/SELL records from token_transfers to token_trades ===`)
  
  for (const row of tradeRows) {
    try {
      console.log(`Processing ${row.side} operation: token ${row.token_id}, tx ${row.tx_hash}, log_index ${row.log_index}`)
      
      // Check if this token has a DEX pool (only move DEX operations, not bonding curve)
      const { rows: poolRows } = await pool.query(
        'SELECT pair_address FROM public.dex_pools WHERE token_id = $1 AND chain_id = $2',
        [row.token_id, chainId]
      )
      
      if (poolRows.length === 0) {
        console.log(`Token ${row.token_id} has no DEX pool, skipping ${row.side} move (likely bonding curve operation)`)
        continue
      }
      
      console.log(`Token ${row.token_id} has DEX pool: ${poolRows[0].pair_address}`)
      
      // Check if this operation happened after graduation (DEX operations)
      const { rows: tokenRows } = await pool.query(
        'SELECT is_graduated, created_at FROM public.tokens WHERE id = $1',
        [row.token_id]
      )
      
      if (tokenRows.length === 0) {
        console.log(`Token ${row.token_id} not found, skipping`)
        continue
      }
      
      const token = tokenRows[0]
      console.log(`Token ${row.token_id} graduation status: is_graduated=${token.is_graduated}`)
      
      // Only move operations that happened after graduation or if token is graduated
      if (!token.is_graduated) {
        console.log(`Token ${row.token_id} not graduated, skipping ${row.side} move (likely bonding curve operation)`)
        continue
      }
      
      // Get transaction details
      let tx
      let attempts = 0
      while (true) {
        try {
          tx = await provider.getTransaction(row.tx_hash)
          await sleep(15)
          break
        } catch (e) {
          attempts++
          if (isRateLimit(e) && attempts <= 5) {
            const backoff = Math.min(1000 * attempts, 5000)
            await sleep(backoff)
            continue
          }
          throw e
        }
      }
      
      if (!tx) {
        console.log(`Could not get transaction ${row.tx_hash} for ${row.side} move`)
        continue
      }
      
      console.log(`Got transaction details for ${row.side} move: tx=${row.tx_hash}, from=${tx.from}`)
      
      // Insert into token_trades table
      const insertQuery = `
        INSERT INTO public.token_trades
          (token_id, chain_id, src, tx_hash, log_index, block_number, block_time, side, trader, amount_token_wei, amount_eth_wei, price_eth_per_token)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING
      `
      
      // Determine trader based on operation type
      const trader = row.side === 'BUY' ? tx.from : tx.to
      
      await pool.query(insertQuery, [
        row.token_id,
        chainId,
        'DEX', // src
        row.tx_hash,
        row.log_index,
        row.block_number,
        row.block_time,
        row.side,
        trader, // trader (user who performed the operation)
        row.amount_wei,
        row.amount_eth_wei,
        row.price_eth_per_token
      ])
      
      // Remove from token_transfers
      await pool.query(
        'DELETE FROM public.token_transfers WHERE chain_id = $1 AND tx_hash = $2 AND log_index = $3',
        [chainId, row.tx_hash, row.log_index]
      )
      
      console.log(`Moved ${row.side} operation: token ${row.token_id}, tx ${row.tx_hash}`)
      
    } catch (error) {
      console.error(`Error moving ${row.side} operation for token ${row.token_id}, tx ${row.tx_hash}:`, error)
    }
  }
}

export async function convertTransfersToDexTrades(
  transferRows: Array<{
    token_id: number
    tx_hash: string
    log_index: number
    amount_wei: string
    block_number: number
    block_time: Date
    contract_address: string
  }>,
  chainId: number,
  provider: ethers.JsonRpcProvider
) {
  console.log(`\n=== Converting ${transferRows.length} TRANSFER records to DEX trades ===`)
  
  for (const row of transferRows) {
    try {
      console.log(`Processing TRANSFER: token ${row.token_id}, tx ${row.tx_hash}, log_index ${row.log_index}`)
      
      // Check if this token has a DEX pool
      const { rows: poolRows } = await pool.query(
        'SELECT pair_address, token0, token1, quote_token FROM public.dex_pools WHERE token_id = $1 AND chain_id = $2',
        [row.token_id, chainId]
      )
      
      if (poolRows.length === 0) {
        console.log(`Token ${row.token_id} has no DEX pool, skipping TRANSFER conversion`)
        continue
      }
      
      const pairAddress = poolRows[0].pair_address
      
      // Get the transaction to analyze it
      let tx
      let attempts = 0
      while (true) {
        try {
          tx = await provider.getTransaction(row.tx_hash)
          await sleep(15)
          break
        } catch (e) {
          attempts++
          if (isRateLimit(e) && attempts <= 5) {
            const backoff = Math.min(1000 * attempts, 5000)
            await sleep(backoff)
            continue
          }
          throw e
        }
      }
      
      if (!tx) {
        console.log(`Could not get transaction ${row.tx_hash} for TRANSFER conversion`)
        continue
      }
      
      // Check if this is a DEX swap by looking for swap events in the transaction
      let receipt
      let receiptAttempts = 0
      while (true) {
        try {
          receipt = await provider.getTransactionReceipt(row.tx_hash)
          await sleep(15)
          break
        } catch (e) {
          receiptAttempts++
          if (isRateLimit(e) && receiptAttempts <= 5) {
            const backoff = Math.min(1000 * receiptAttempts, 5000)
            await sleep(backoff)
            continue
          }
          throw e
        }
      }
      
      if (!receipt) {
        console.log(`Could not get receipt for ${row.tx_hash}`)
        continue
      }
      
      // Look for Swap events from the DEX pair
      const swapTopic = ethers.id('Swap(address,uint256,uint256,uint256,uint256,address)')
      const swapLogs = receipt.logs.filter(log => 
        log.address.toLowerCase() === pairAddress.toLowerCase() && 
        log.topics[0] === swapTopic
      )
      
      if (swapLogs.length === 0) {
        console.log(`No swap events found for TRANSFER ${row.tx_hash}, skipping`)
        continue
      }
      
      // Parse the swap event to determine if it's a buy or sell
      const swapLog = swapLogs[0] // Take the first swap event
      const swapInterface = new ethers.Interface([
        'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)'
      ])
      
      const decoded = swapInterface.parseLog(swapLog)
      if (!decoded) {
        console.log(`Could not parse swap event for ${row.tx_hash}`)
        continue
      }
      
      const { amount0In, amount1In, amount0Out, amount1Out } = decoded.args
      
      // Get pool info to determine token order (same logic as main DEX processing)
      const { rows: poolInfo } = await pool.query(
        'SELECT token0, token1, quote_token FROM public.dex_pools WHERE token_id = $1 AND chain_id = $2',
        [row.token_id, chainId]
      )
      
      if (poolInfo.length === 0) {
        console.log(`No pool info found for token ${row.token_id}`)
        continue
      }
      
      const poolData = poolInfo[0]
      const isQuoteToken0 = poolData.quote_token.toLowerCase() === poolData.token0.toLowerCase()
      
      // Determine if this is a buy or sell based on swap amounts
      let side: string
      let ethAmount: bigint
      let price: number
      
      if (isQuoteToken0) {
        // Quote token is token0
        if (amount0In > 0n && amount1Out > 0n) {
          side = 'BUY'
          ethAmount = amount0In
          price = Number(ethAmount) / Number(row.amount_wei)
        } else if (amount1In > 0n && amount0Out > 0n) {
          side = 'SELL'
          ethAmount = amount0Out
          price = Number(ethAmount) / Number(row.amount_wei)
        } else {
          console.log(`Could not determine swap direction for ${row.tx_hash}`)
          continue
        }
      } else {
        // Quote token is token1
        if (amount1In > 0n && amount0Out > 0n) {
          side = 'BUY'
          ethAmount = amount1In
          price = Number(ethAmount) / Number(row.amount_wei)
        } else if (amount0In > 0n && amount1Out > 0n) {
          side = 'SELL'
          ethAmount = amount1Out
          price = Number(ethAmount) / Number(row.amount_wei)
        } else {
          console.log(`Could not determine swap direction for ${row.tx_hash}`)
          continue
        }
      }
      
      // Insert into token_trades
      await pool.query(
        `INSERT INTO public.token_trades
          (token_id, chain_id, src, tx_hash, log_index, block_number, block_time, side, trader, amount_token_wei, amount_eth_wei, price_eth_per_token)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
        [
          row.token_id,
          chainId,
          'DEX', // src
          row.tx_hash,
          row.log_index,
          row.block_number,
          row.block_time,
          side,
          side === 'BUY' ? tx.from : tx.to, // trader (user who performed the operation)
          row.amount_wei,
          ethAmount.toString(),
          price
        ]
      )
      
      // Remove from token_transfers
      await pool.query(
        'DELETE FROM public.token_transfers WHERE chain_id = $1 AND tx_hash = $2 AND log_index = $3',
        [chainId, row.tx_hash, row.log_index]
      )
      
      console.log(`Converted TRANSFER to ${side}: token ${row.token_id}, tx ${row.tx_hash}, eth=${ethAmount.toString()}, price=${price}`)
      
    } catch (error) {
      console.error(`Error converting TRANSFER for token ${row.token_id}, tx ${row.tx_hash}:`, error)
    }
  }
}
