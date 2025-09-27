'use client'

import { useRouter } from 'next/navigation'
import { formatLargeNumber } from '@/lib/displayFormats'

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
  price_eth_per_token: number | string | null
  price_change_pct: number | string | null
}

interface TransactionCardProps {
  transaction: Transaction
}

// Helper function to format addresses
const formatAddress = (address: string): string => {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// Get transaction color based on side
const getTransactionColor = (side: string): string => {
  switch (side) {
    case 'BUY':
    case 'BUY&LOCK':
      return 'text-green-400'
    case 'SELL':
      return 'text-orange-400'
    case 'GRADUATION':
      return 'text-blue-400'
    case 'UNLOCK':
      return 'text-purple-400'
    case 'CLAIMAIRDROP':
      return 'text-gray-400'
    case 'LAUNCH':
      return 'text-cyan-400'
    default:
      return 'text-gray-400'
  }
}

// Format USD value
const formatUSDValue = (value: number | string | null): string => {
  const numValue = typeof value === 'string' ? parseFloat(value) : (value || 0)
  
  if (isNaN(numValue) || numValue === 0) return '$0'
  if (numValue < 0.01) return '<$0.01'
  if (numValue < 1) return `$${numValue.toFixed(3)}`
  if (numValue < 1000) return `$${numValue.toFixed(2)}`
  return `$${formatLargeNumber(numValue)}`
}

// Format price change percentage
const formatPriceChange = (change: number | null | string | undefined): { text: string; color: string } => {
  // Convert to number and validate
  const numChange = typeof change === 'string' ? parseFloat(change) : (change || 0)
  
  if (change === null || change === undefined || isNaN(numChange) || !isFinite(numChange)) {
    return { text: '', color: '' }
  }
  
  const absChange = Math.abs(numChange)
  
  // Don't show anything if change is less than 1%
  if (absChange < 1) {
    return { text: '', color: '' }
  }
  
  // Handle >100% changes with "x times" format
  if (absChange > 100) {
    const times = Math.round(absChange / 100)
    const text = `${times}x`
    return { text, color: numChange > 0 ? 'text-green-400' : 'text-red-400' }
  }
  
  // Regular percentage format (no decimals, no + sign)
  const text = `${Math.round(absChange)}%`
  return { text, color: numChange > 0 ? 'text-green-400' : 'text-red-400' }
}

export default function TransactionCard({ transaction }: TransactionCardProps) {
  const router = useRouter()

  // Validate transaction data
  if (!transaction || !transaction.id || !transaction.symbol) {
    return null
  }

  // Get token image URL
  const getTokenImageUrl = () => {
    if (transaction.token_logo_asset_id) {
      return `/api/media/${transaction.token_logo_asset_id}?v=thumb`
    }
    if (transaction.image) {
      return transaction.image
    }
    return null
  }

  const handleClick = () => {
    router.push(`/?selected=${transaction.id}`)
  }

  const imageUrl = getTokenImageUrl()
  const traderDisplay = transaction.trader_name && transaction.trader_name !== '[NULL]' && transaction.trader_name.trim() !== ''
    ? transaction.trader_name 
    : formatAddress(transaction.trader || '')
  const sideColor = getTransactionColor(transaction.side || '')
  const usdValue = formatUSDValue(transaction.value)
  const priceChange = formatPriceChange(transaction.price_change_pct)

  return (
    <div 
      className="flex items-center bg-gray-800 border border-gray-600 rounded-lg p-2 min-w-[200px] flex-shrink-0 cursor-pointer hover:scale-[1.05] hover:shadow-2xl hover:shadow-purple-500/25 hover:border-purple-400/50 hover:bg-gray-700 transition-all duration-300"
      onClick={handleClick}
    >
      {/* Token Image */}
      <div className="w-8 h-8 mr-3 flex-shrink-0">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={transaction.symbol}
            className="w-full h-full object-cover rounded"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full bg-gray-600 rounded flex items-center justify-center">
            <span className="text-xs text-gray-400">?</span>
          </div>
        )}
      </div>

      {/* Token Info */}
      <div className="flex-1 min-w-0">
        {/* Token Symbol + Price Change */}
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium text-white truncate">
            {transaction.symbol}
          </div>
          {priceChange.text && (
            <div className={`text-xs font-medium ${priceChange.color} ml-2 flex-shrink-0 flex items-center`}>
              <span className="text-gray-400 mr-1">24h</span>
              {priceChange.color === 'text-green-400' ? (
                <span className="mr-1">↑</span>
              ) : priceChange.color === 'text-red-400' ? (
                <span className="mr-1">↓</span>
              ) : null}
              {priceChange.text}
            </div>
          )}
        </div>
        
        {/* Trader + Side + Value */}
        <div className="text-xs text-gray-300 truncate">
          <span className="text-gray-400">{traderDisplay}</span>
          <span className={`ml-1 ${sideColor}`}>{transaction.side}</span>
          {transaction.side !== 'LAUNCH' && transaction.side !== 'UNLOCK' && (
            <span className={`ml-1 ${sideColor}`}>{usdValue}</span>
          )}
        </div>
      </div>
    </div>
  )
}
