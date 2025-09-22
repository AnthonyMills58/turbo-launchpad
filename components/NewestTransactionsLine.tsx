'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useChainId } from 'wagmi'
import TransactionCard from './TransactionCard'

interface Transaction {
  id: number
  symbol: string
  image: string | null
  token_logo_asset_id: string | null
  contract_address: string
  trader: string
  side: string
  value: number | string | null
  block_time: string
  trader_name: string | null
  log_index: number
}

export default function NewestTransactionsLine() {
  const chainId = useChainId()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isAnimating, setIsAnimating] = useState(false)
  const previousTransactionsRef = useRef<Transaction[]>([])
  const isFirstRunRef = useRef(true)

  const fetchTransactions = useCallback(async () => {
    try {
      console.log(`[NewestTransactionsLine] 🔍 Fetching transactions for chainId: ${chainId}`)
      const response = await fetch(`/api/newest-transactions?chainId=${chainId}`)
      const data = await response.json()
      
      console.log(`[NewestTransactionsLine] 📊 API Response:`, data)
      
      if (data.success && data.transactions && data.transactions.length > 0) {
        const newTransactions = data.transactions
        console.log(`[NewestTransactionsLine] 📝 Found ${newTransactions.length} transactions`)
        
        // Check if this is the very first run or if there are new transactions
        console.log(`[NewestTransactionsLine] 🔍 Debug - isFirstRunRef.current: ${isFirstRunRef.current}`)
        console.log(`[NewestTransactionsLine] 🔍 Debug - previousTransactionsRef.current.length: ${previousTransactionsRef.current.length}`)
        
        if (isFirstRunRef.current) {
          // First runtime - sync all tokens treating them as new
          const uniqueTokenIds = new Set(newTransactions.map((t: Transaction) => t.id))
          console.log(`[NewestTransactionsLine] 🚀 FIRST RUNTIME - syncing all ${uniqueTokenIds.size} unique tokens`)
          
          // Trigger sync for each unique token (don't await to avoid blocking)
          uniqueTokenIds.forEach(async (tokenId) => {
            try {
              const token = newTransactions.find((t: Transaction) => t.id === tokenId)
              if (token) {
                console.log(`[NewestTransactionsLine] First runtime sync for token ${tokenId} (${token.symbol})`)
                await fetch('/api/sync', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    tokenId: tokenId,
                    contractAddress: token.contract_address,
                    chainId: chainId
                  })
                })
              }
            } catch (error) {
              console.error(`[NewestTransactionsLine] Failed to sync token ${tokenId}:`, error)
            }
          })
          
          // Mark first run as complete
          isFirstRunRef.current = false
          
          // First load, no animation
          setTransactions(newTransactions)
        } else if (previousTransactionsRef.current.length > 0) {
          const previousIds = new Set(previousTransactionsRef.current.map(t => `${t.id}-${t.block_time}-${t.log_index}`))
          const newTransactionList = newTransactions.filter((t: Transaction) => 
            !previousIds.has(`${t.id}-${t.block_time}-${t.log_index}`)
          )
          const hasNewTransactions = newTransactionList.length > 0
          
          if (hasNewTransactions) {
            // Sync only tokens with new transactions
            const newTokenIds = new Set(newTransactionList.map((t: Transaction) => t.id))
            console.log(`[NewestTransactionsLine] Found ${newTransactionList.length} new transactions for ${newTokenIds.size} unique tokens`)
            
            // Trigger sync for each token with new transactions (don't await to avoid blocking)
            newTokenIds.forEach(async (tokenId) => {
              try {
                const token = newTransactionList.find((t: Transaction) => t.id === tokenId)
                if (token) {
                  console.log(`[NewestTransactionsLine] Syncing token ${tokenId} (${token.symbol}) - has new transaction`)
                  await fetch('/api/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      tokenId: tokenId,
                      contractAddress: token.contract_address,
                      chainId: chainId
                    })
                  })
                }
              } catch (error) {
                console.error(`[NewestTransactionsLine] Failed to sync token ${tokenId}:`, error)
              }
            })
            
            // Trigger sliding animation
            setIsAnimating(true)
            
            // Update transactions immediately
            setTransactions(newTransactions)
            
            // Stop animation after 1 second
            setTimeout(() => {
              setIsAnimating(false)
            }, 1000)
          } else {
            // No new transactions, just update silently
            console.log(`[NewestTransactionsLine] No new transactions found, skipping sync`)
            setTransactions(newTransactions)
          }
        } else {
          // No previous transactions and not first run - just update silently
          console.log(`[NewestTransactionsLine] No previous transactions, updating silently`)
          setTransactions(newTransactions)
        }
        
        previousTransactionsRef.current = newTransactions
      } else {
        setTransactions([])
      }
    } catch (error) {
      console.error('Error fetching newest transactions:', error)
      setTransactions([])
    } finally {
      setIsLoading(false)
    }
  }, [chainId])

  useEffect(() => {
    if (chainId) {
      fetchTransactions()
      
      // Set up polling every 60 seconds
      const interval = setInterval(fetchTransactions, 60000)
      
      return () => {
        clearInterval(interval)
      }
    }
  }, [chainId, fetchTransactions])

  // Don't render if loading, no transactions, or no chain ID
  if (isLoading || transactions.length === 0 || !chainId) {
    return null
  }

  return (
    <div className="w-full bg-transparent">
      {/* Horizontal scrollable container */}
      <div 
        className={`flex gap-2 overflow-x-auto px-4 py-3 bg-transparent transition-all duration-1000 ease-in-out ${
          isAnimating ? 'transform translate-x-2' : 'transform translate-x-0'
        }`}
        style={{ 
          scrollbarWidth: 'none', 
          msOverflowStyle: 'none'
        }}
      >
        {transactions.map((transaction, index) => {
          const transactionKey = `${transaction.id}-${transaction.block_time}-${transaction.log_index}`
          
          return (
            <div
              key={transactionKey}
              className={`transition-all duration-1000 ease-in-out ${
                isAnimating 
                  ? `transform translate-x-${Math.min(index * 2, 20)} opacity-90` 
                  : 'transform translate-x-0 opacity-100'
              }`}
              style={{
                transitionDelay: `${index * 50}ms`
              }}
            >
              <TransactionCard transaction={transaction} />
            </div>
          )
        })}
      </div>
    </div>
  )
}