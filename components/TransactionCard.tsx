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

export default function TransactionCard({ transaction }: TransactionCardProps) {
  const router = useRouter()

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
    : formatAddress(transaction.trader)
  const sideColor = getTransactionColor(transaction.side)
  const usdValue = formatUSDValue(transaction.value)

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
        {/* Token Symbol */}
        <div className="text-xs font-medium text-white truncate">
          {transaction.symbol}
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
