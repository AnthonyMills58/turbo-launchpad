'use client'

import { useState, useEffect, useCallback, memo } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Copy } from 'lucide-react'
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from '@/lib/chains'
import { useChainId } from 'wagmi'
import { formatLargeNumber } from '@/lib/displayFormats'
import { formatPriceMetaMask } from '@/lib/ui-utils'
import Image from 'next/image'

interface Transaction {
  block_time: string
  tx_hash: string
  from_address: string
  to_address: string
  amount_wei: string
  amount_eth_wei: string
  price_eth_per_token: string
  side: string
  src: string
  eth_price_usd: number
  creator_wallet?: string
}

interface TransactionTableProps {
  tokenId: number
  tokenSymbol: string
  creatorWallet: string
}

// Helper function to format addresses
const formatAddress = (address: string): string => {
  if (!address) return ''
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

// Memoized TraderDisplay component to prevent re-renders
const TraderDisplay = memo(({ address }: { address: string }) => {
  const [profile, setProfile] = useState<{display_name: string, avatar_asset_id?: string, bio?: string} | null>(null)
  const [showTooltip, setShowTooltip] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let isMounted = true
    
    const loadProfile = async () => {
      try {
        const response = await fetch(`/api/profile?wallet=${address}`)
        if (response.ok && isMounted) {
          const data = await response.json()
          if (data.success && data.profile?.display_name && isMounted) {
            setProfile(data.profile)
          }
        }
      } catch (error) {
        console.error('Failed to fetch profile:', error)
      }
    }
    
    loadProfile()
    
    return () => {
      isMounted = false
    }
  }, [address])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy address:', error)
    }
  }

  const displayName = profile?.display_name
  const hasProfile = !!displayName

  return (
    <div 
      className="relative inline-block"
      onMouseEnter={() => hasProfile && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex items-center gap-2">
        <span className="text-gray-300">
          {hasProfile ? `${displayName} (${formatAddress(address)})` : formatAddress(address)}
        </span>
        {hasProfile && (
          <button
            onClick={handleCopy}
            className="hover:text-white transition-colors"
            title="Copy wallet address"
          >
            <Copy className="w-3 h-3 text-gray-400" />
          </button>
        )}
      </div>
      
      {/* Tooltip similar to UserProfile */}
      {showTooltip && hasProfile && (
        <div className="absolute z-[9999] top-full right-0 transform translate-x-0 -mt-3 px-4 py-3 bg-[#1b1e2b] border-2 border-gray-600 rounded-xl shadow-2xl shadow-gray-500/20 text-white text-xs min-w-64 max-w-80 w-fit transition-all duration-200 ease-in-out opacity-100">
          <div className="flex items-start gap-4">
            {/* Left side: Avatar */}
            <div className="flex-shrink-0">
              {profile.avatar_asset_id ? (
                <div className="w-24 h-24 rounded-full overflow-hidden flex-shrink-0 bg-gray-700 ring-2 ring-purple-400/20 shadow-lg">
                  <Image
                    src={`/api/media/${profile.avatar_asset_id}?v=thumb`}
                    alt={displayName}
                    width={96}
                    height={96}
                    className="w-full h-full object-cover object-center"
                  />
                </div>
              ) : (
                <div className="w-24 h-24 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-2xl text-white shadow-lg ring-2 ring-purple-400/20">
                  {address[0].toUpperCase()}
                </div>
              )}
            </div>
            
            {/* Right side: Profile info */}
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-bold mb-2 bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent truncate">
                {displayName}
              </div>
              
              {/* Address with copy functionality */}
              <div className="flex items-center justify-center gap-2 text-xs text-gray-400 mb-2">
                <span className="font-mono">{formatAddress(address)}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCopy()
                  }}
                  className="hover:text-white transition-colors"
                  title="Copy wallet address"
                >
                  <Copy size={12} />
                </button>
                {copied && <span className="text-green-400 text-xs">Copied!</span>}
              </div>
              
              {profile.bio && (
                <div className="text-xs text-gray-300 line-clamp-3">
                  {profile.bio}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

TraderDisplay.displayName = 'TraderDisplay'

export default function TransactionTable({ tokenId, tokenSymbol, creatorWallet }: TransactionTableProps) {
  const chainId = useChainId()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [filters, setFilters] = useState({
    side: '',
    maker: ''
  })

  // Chain explorer setup
  const chainMap = {
    [megaethTestnet.id]: megaethTestnet,
    [megaethMainnet.id]: megaethMainnet,
    [sepoliaTestnet.id]: sepoliaTestnet,
  } as const

  const chain = chainMap[chainId as keyof typeof chainMap]
  const explorerBaseUrl = chain?.blockExplorers?.default.url ?? ''

  const pageSize = 20

  // Fetch transactions
  const fetchTransactions = useCallback(async (page: number = 1) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        tokenId: tokenId.toString(),
        page: page.toString(),
        pageSize: pageSize.toString(),
        creatorWallet: creatorWallet,
        ...(filters.side && { side: filters.side }),
        ...(filters.maker && { maker: filters.maker })
      })

      const response = await fetch(`/api/transactions?${params}`)
      if (response.ok) {
        const data = await response.json()
        setTransactions(data.transactions || [])
        setTotalPages(data.totalPages || 1)
        setTotalCount(data.totalCount || 0)
        setCurrentPage(page)
      }
    } catch (error) {
      console.error('Failed to fetch transactions:', error)
    } finally {
      setLoading(false)
    }
  }, [tokenId, creatorWallet, filters.side, filters.maker])

  useEffect(() => {
    fetchTransactions(1)
  }, [tokenId, filters, fetchTransactions])

  // Get trader address based on transaction type
  const getTraderAddress = (transaction: Transaction): string => {
    switch (transaction.side) {
      case 'BUY&LOCK':
      case 'GRADUATION':
      case 'UNLOCK':
        return creatorWallet
      case 'BUY':
      case 'CLAIMAIRDROP':
        return transaction.to_address
      case 'SELL':
        return transaction.from_address
      default:
        return ''
    }
  }

  // Get transaction type color
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
      default:
        return 'text-gray-400'
    }
  }


  // Format time ago
  const formatTimeAgo = (timestamp: string): string => {
    const now = new Date()
    const time = new Date(timestamp)
    const diffMs = now.getTime() - time.getTime()
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
    const diffDays = Math.floor(diffHours / 24)

    if (diffDays > 0) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
    } else if (diffHours > 0) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
    } else {
      const diffMinutes = Math.floor(diffMs / (1000 * 60))
      return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`
    }
  }




  // Calculate USD value
  const calculateUSDValue = (ethWei: string, ethPriceUsd: number): string => {
    const ethAmount = parseFloat(ethWei) / 1e18
    const usdValue = ethAmount * ethPriceUsd
    return `$${usdValue.toFixed(2)}`
  }

  // Format ETH value using same logic as USD
  const formatETHValue = (ethAmount: number): string => {
    if (ethAmount < 0.001) {
      const ethInfo = formatPriceMetaMask(ethAmount)
      if (ethInfo.type === 'metamask') {
        return `${ethInfo.value}${ethInfo.zeros}${ethInfo.digits}`
      }
      return ethInfo.value
    }

    if (ethAmount >= 1000) {
      return formatLargeNumber(ethAmount)
    }

    if (ethAmount >= 0.1) {
      return ethAmount.toFixed(2)
    } else if (ethAmount >= 0.01) {
      return ethAmount.toFixed(3)
    } else {
      return ethAmount.toFixed(4)
    }
  }

  // Pagination handlers
  const goToFirstPage = () => fetchTransactions(1)
  const goToPrevPage = () => currentPage > 1 && fetchTransactions(currentPage - 1)
  const goToNextPage = () => currentPage < totalPages && fetchTransactions(currentPage + 1)
  const goToLastPage = () => fetchTransactions(totalPages)

  // Filter handlers
  const handleSideFilter = (side: string) => {
    setFilters(prev => ({ ...prev, side }))
  }

  const handleMakerFilter = (maker: string) => {
    setFilters(prev => ({ ...prev, maker }))
  }

  return (
    <div className="w-full bg-transparent">
      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Type:</label>
          <select
            value={filters.side}
            onChange={(e) => handleSideFilter(e.target.value)}
            className="px-3 py-1 bg-transparent border border-gray-600 text-white text-sm rounded"
          >
            <option value="">All</option>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
            <option value="BUY&LOCK">Buy & Lock</option>
            <option value="UNLOCK">Unlock</option>
            <option value="GRADUATION">Graduation</option>
            <option value="CLAIMAIRDROP">Claim Airdrop</option>
          </select>
        </div>
        
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Trader:</label>
          <input
            type="text"
            value={filters.maker}
            onChange={(e) => handleMakerFilter(e.target.value)}
            placeholder="Address or ENS name"
            className="px-3 py-1 bg-transparent border border-gray-600 text-white text-sm rounded min-w-[200px]"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-gray-600">
              <th className="text-left py-3 px-2 text-sm text-gray-400 font-medium">Date</th>
              <th className="text-left py-3 px-2 text-sm text-gray-400 font-medium">Type</th>
              <th className="text-left py-3 px-2 text-sm text-gray-400 font-medium">USD</th>
              <th className="text-left py-3 px-2 text-sm text-gray-400 font-medium">ETH</th>
              <th className="text-left py-3 px-2 text-sm text-gray-400 font-medium">{tokenSymbol}</th>
              <th className="text-left py-3 px-2 text-sm text-gray-400 font-medium">Trader</th>
              <th className="text-left py-3 px-2 text-sm text-gray-400 font-medium">Tx</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-400">
                  Loading transactions...
                </td>
              </tr>
            ) : transactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-400">
                  No transactions found
                </td>
              </tr>
            ) : (
              transactions.map((tx, index) => {
                const traderAddress = getTraderAddress(tx)
                const tokenAmount = formatLargeNumber(parseFloat(tx.amount_wei) / 1e18)
                const ethAmount = parseFloat(tx.amount_eth_wei) / 1e18
                const ethDisplay = formatETHValue(ethAmount)
                const usdValue = calculateUSDValue(tx.amount_eth_wei, tx.eth_price_usd)
                const explorerLink = `${explorerBaseUrl}/tx/${tx.tx_hash}`

                return (
                  <tr key={`${tx.tx_hash}-${index}`} className="border-b border-gray-700 hover:bg-gray-800/20">
                    <td className="py-3 px-2 text-sm text-gray-300">
                      {formatTimeAgo(tx.block_time)}
                    </td>
                    <td className={`py-3 px-2 text-sm font-medium ${getTransactionColor(tx.side)}`}>
                      {tx.side}
                    </td>
                    <td className="py-3 px-2 text-sm text-gray-300">
                      {usdValue}
                    </td>
                    <td className="py-3 px-2 text-sm text-gray-300">
                      {ethDisplay}
                    </td>
                    <td className="py-3 px-2 text-sm text-gray-300">
                      {tokenAmount}
                    </td>
                    <td className="py-3 px-2 text-sm text-gray-300">
                      <TraderDisplay address={traderAddress} />
                    </td>
                    <td className="py-3 px-2 text-sm">
                      <a
                        href={explorerLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-white transition-colors"
                      >
                        🔗
                      </a>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-gray-400">
          Showing {transactions.length} of {totalCount} transactions
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={goToFirstPage}
            disabled={currentPage === 1}
            className="p-2 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="First page"
          >
            <ChevronsLeft size={16} />
          </button>
          
          <button
            onClick={goToPrevPage}
            disabled={currentPage === 1}
            className="p-2 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          
          <span className="px-3 py-1 text-sm text-gray-300">
            Page {currentPage} of {totalPages}
          </span>
          
          <button
            onClick={goToNextPage}
            disabled={currentPage === totalPages}
            className="p-2 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Next page"
          >
            <ChevronRight size={16} />
          </button>
          
          <button
            onClick={goToLastPage}
            disabled={currentPage === totalPages}
            className="p-2 text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Last page"
          >
            <ChevronsRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

