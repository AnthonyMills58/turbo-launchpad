'use client'

import { useState, useEffect, useRef } from 'react'
import { useChainId } from 'wagmi'
import { useSync } from '@/lib/SyncContext'
import TransactionCard from './TransactionCard'
import SparkleAnimation from './SparkleAnimation'

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
}

export default function NewestTransactionsLine() {
  const chainId = useChainId()
  const { triggerSync } = useSync()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [newTransactionIds, setNewTransactionIds] = useState<Set<string>>(new Set())
  const previousTransactionsRef = useRef<Transaction[]>([])
  const sparkleTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const fetchTransactions = async () => {
    try {
      const response = await fetch(`/api/newest-transactions?chainId=${chainId}`)
      const data = await response.json()
      
      if (data.success && data.transactions && data.transactions.length > 0) {
        const newTransactions = data.transactions
        
        // Check for new transactions (not the first load)
        if (previousTransactionsRef.current.length > 0) {
          const previousIds = new Set(previousTransactionsRef.current.map(t => `${t.id}-${t.block_time}-${t.log_index}`))
          const newIds = new Set<string>()
          
          newTransactions.forEach(transaction => {
            const transactionKey = `${transaction.id}-${transaction.block_time}-${transaction.log_index}`
            if (!previousIds.has(transactionKey)) {
              newIds.add(transactionKey)
            }
          })
          
          if (newIds.size > 0) {
            setNewTransactionIds(newIds)
            
            // Clear any existing timeout
            if (sparkleTimeoutRef.current) {
              clearTimeout(sparkleTimeoutRef.current)
            }
            
            // Clear new transaction IDs after animation duration and trigger refresh
            sparkleTimeoutRef.current = setTimeout(() => {
              setNewTransactionIds(new Set())
              // Trigger TokenDetailsView refresh when sparkles end
              triggerSync()
            }, 2000)
          }
        }
        
        setTransactions(newTransactions)
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
  }

  useEffect(() => {
    if (chainId) {
      fetchTransactions()
      
      // Set up polling every 60 seconds
      const interval = setInterval(fetchTransactions, 60000)
      
      return () => {
        clearInterval(interval)
        // Clean up sparkle timeout on unmount
        if (sparkleTimeoutRef.current) {
          clearTimeout(sparkleTimeoutRef.current)
        }
      }
    }
  }, [chainId])

  // Don't render if loading, no transactions, or no chain ID
  if (isLoading || transactions.length === 0 || !chainId) {
    return null
  }

  return (
    <div className="w-full bg-transparent">
      {/* Horizontal scrollable container */}
      <div 
        className="flex gap-2 overflow-x-auto px-4 py-3 bg-transparent" 
        style={{ 
          scrollbarWidth: 'none', 
          msOverflowStyle: 'none'
        }}
      >
        {transactions.map((transaction) => {
          const transactionKey = `${transaction.id}-${transaction.block_time}-${transaction.log_index}`
          const isNew = newTransactionIds.has(transactionKey)
          
          return (
            <SparkleAnimation key={transactionKey} isVisible={isNew}>
              <TransactionCard transaction={transaction} />
            </SparkleAnimation>
          )
        })}
      </div>
    </div>
  )
}
