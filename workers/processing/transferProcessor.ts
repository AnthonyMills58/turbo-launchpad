// Transfer processing for bonding curve operations
// Extracted from workers/index.ts

import { ethers } from 'ethers'
import type { Log } from 'ethers'
import type { PoolClient } from 'pg'
import { ZERO } from '../core/config'
import { sleep, isRateLimit } from '../core/rateLimiting'
import { providerFor } from '../core/providers'

type TokenRow = {
  id: number
  chain_id: number
  contract_address: string | null
  creator_wallet: string | null
}

export async function processTransferLogs(
  logs: Log[],
  tokens: TokenRow[],
  chainId: number,
  tsByBlock: Map<number, number>,
  client: PoolClient
): Promise<Set<number>> {
  const touchedTokenIds = new Set<number>()
  
  for (const log of logs) {
    try {
      const tokenId = tokens.find(t => 
        t.contract_address?.toLowerCase() === log.address.toLowerCase()
      )?.id
      
      if (!tokenId) continue
      
      const fromAddr = ethers.getAddress('0x' + log.topics[1].slice(26))
      const toAddr = ethers.getAddress('0x' + log.topics[2].slice(26))
      const amount = BigInt(log.data)
      
      // Skip zero transfers
      if (amount === 0n) continue
      
      const blockTime = new Date((tsByBlock.get(log.blockNumber!) ?? Date.now() / 1000) * 1000)
      
      // Get transaction details with rate limiting
      let tx
      let attempts = 0
      while (true) {
        try {
          tx = await providerFor(chainId).getTransaction(log.transactionHash!)
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
      
      if (!tx) continue
      
      // Get creator wallet for this token
      const token = tokens.find(t => t.id === tokenId)
      const creatorWallet = token?.creator_wallet || null
      
      // Identify transfer type
      const transferType = await identifyTransferType(
        tx, 
        fromAddr, 
        toAddr, 
        chainId, 
        log.address, 
        creatorWallet
      )
      
      // Calculate ETH amount and price
      let ethAmount = 0n
      let price = null
      
      if (transferType === 'BUY') {
        // Buy operation: user sends ETH to contract, receives tokens
        ethAmount = tx.value || 0n
        if (ethAmount > 0n) {
          price = Number(ethAmount) / Number(amount)
        }
        console.log(`Token ${tokenId}: BUY tx=${log.transactionHash}, eth=${ethAmount.toString()}, tokens=${amount.toString()}, price=${price}`)
      } else if (transferType === 'SELL') {
        // Sell operation: user sends tokens to contract, receives ETH
        // Try to calculate the sell price by calling getSellPrice at the transaction block
        try {
          let receipt
          let receiptAttempts = 0
          while (true) {
            try {
              receipt = await providerFor(chainId).getTransactionReceipt(log.transactionHash!)
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
          
          if (receipt) {
            // Call getSellPrice at the block before the transaction
            // This gives us the price that was used for this sell
            const blockBeforeTx = receipt.blockNumber - 1
            
            try {
              const turboTokenInterface = new ethers.Interface([
                'function getSellPrice(uint256 amount) view returns (uint256)'
              ])
              
              const sellPriceWei = await providerFor(chainId).call({
                to: log.address,
                data: turboTokenInterface.encodeFunctionData('getSellPrice', [amount]),
                blockTag: blockBeforeTx
              })
              
                  if (sellPriceWei && sellPriceWei !== '0x') {
                    ethAmount = BigInt(sellPriceWei)
                    price = Number(ethAmount) / Number(amount)
                console.log(`Token ${tokenId}: SELL tx=${log.transactionHash}, eth=${ethAmount.toString()}, tokens=${amount.toString()}, price=${price}`)
              }
            } catch (e) {
              console.warn(`Could not get sell price for ${log.transactionHash}:`, e)
            }
          }
        } catch (e) {
          console.warn(`Could not get receipt for sell transaction ${log.transactionHash}:`, e)
        }
      } else if (transferType === 'GRADUATION') {
        // Graduation: contract mints tokens to itself (will be consolidated later)
        ethAmount = 0n
        price = null
        console.log(`Token ${tokenId}: GRADUATION tx=${log.transactionHash}, tokens=${amount.toString()}`)
      } else {
        // Other transfer (airdrop, etc.)
        ethAmount = 0n
        price = null
      }
      
      // Insert transfer record
      await client.query(
        `INSERT INTO public.token_transfers
          (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
        [
          tokenId,
          chainId,
          log.address,
          log.blockNumber,
          blockTime,
          log.transactionHash,
          log.index,
          fromAddr,
          toAddr,
          amount.toString(),
          ethAmount.toString(),
          price,
          transferType
        ]
      )
      
      touchedTokenIds.add(tokenId)
      
    } catch (error) {
      console.error(`Error processing transfer log ${log.transactionHash}:`, error)
    }
  }
  
  return touchedTokenIds
}

async function identifyTransferType(
  tx: ethers.TransactionResponse,
  fromAddr: string,
  toAddr: string,
  chainId: number,
  contractAddr: string,
  creatorWallet: string | null
): Promise<string> {
  // Check if this is a graduation transaction
  if (fromAddr === ZERO && toAddr.toLowerCase() === contractAddr.toLowerCase()) {
    return 'GRADUATION'
  }
  
  // Check if this is a buy operation (user -> contract)
  if (toAddr.toLowerCase() === contractAddr.toLowerCase() && tx.value && tx.value > 0n) {
    return 'BUY'
  }
  
  // Check if this is a sell operation (contract -> user)
  if (fromAddr.toLowerCase() === contractAddr.toLowerCase() && toAddr !== ZERO) {
    return 'SELL'
  }
  
  // Check if this is an airdrop (creator -> user)
  if (creatorWallet && fromAddr.toLowerCase() === creatorWallet.toLowerCase()) {
    return 'AIRDROP'
  }
  
  return 'OTHER'
}
