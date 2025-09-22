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

  const fetchTransactions = useCallback(async () => {
    try {
      const response = await fetch(`/api/newest-transactions?chainId=${chainId}`)
      const data = await response.json()
      
      if (data.success && data.transactions && data.transactions.length > 0) {
        const newTransactions = data.transactions
        
        // Check if there are new transactions (not the first load)
        if (previousTransactionsRef.current.length > 0) {
          const previousIds = new Set(previousTransactionsRef.current.map(t => `${t.id}-${t.block_time}-${t.log_index}`))
          const hasNewTransactions = newTransactions.some((t: Transaction) => 
            !previousIds.has(`${t.id}-${t.block_time}-${t.log_index}`)
          )
          
          if (hasNewTransactions) {
            // Trigger sliding animation
            setIsAnimating(true)
            
            // Update transactions immediately
            setTransactions(newTransactions)
            
            // Stop animation after 2 seconds
            setTimeout(() => {
              setIsAnimating(false)
            }, 2000)
          } else {
            // No new transactions, just update silently
            setTransactions(newTransactions)
          }
        } else {
          // First load, no animation
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
        className={`flex gap-2 overflow-x-auto px-4 py-3 bg-transparent transition-all duration-2000 ease-in-out ${
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
              className={`transition-all duration-2000 ease-in-out ${
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