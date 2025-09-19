'use client'

import React, { useState, useEffect, useCallback, memo } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ExternalLink } from 'lucide-react'
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from '@/lib/chains'
import { useChainId } from 'wagmi'
import { formatLargeNumber } from '@/lib/displayFormats'
import { formatPriceMetaMask } from '@/lib/ui-utils'

interface Holder {
  id: number
  current_price: number
  price_usd: number
  holder: string
  holder_name: string | null
  amount: number
}

interface HoldersTableProps {
  tokenId: number
  tokenSymbol: string
}

export default function HoldersTable({ tokenId, tokenSymbol }: HoldersTableProps) {
  const chainId = useChainId()
  const [holders, setHolders] = useState<Holder[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [totalSupply, setTotalSupply] = useState(0)
  const [pageSize] = useState(20)

  // Get explorer URL based on chain
  const getExplorerUrl = (address: string) => {
    switch (chainId) {
      case megaethTestnet.id:
        return `https://testnet.megaeth.org/address/${address}`
      case megaethMainnet.id:
        return `https://megaeth.org/address/${address}`
      case sepoliaTestnet.id:
        return `https://sepolia.etherscan.io/address/${address}`
      default:
        return `https://etherscan.io/address/${address}`
    }
  }

  // Format token amount using same logic as TransactionTable
  const formatTokenAmount = (amount: number | string): string => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount
    const tokenAmount = numAmount / 1e18 // Convert from wei to tokens
    return formatLargeNumber(tokenAmount)
  }

  // Format USD value using same logic as TransactionTable
  const formatUSDValue = (ethValue: number, usdPrice: number) => {
    if (!usdPrice || ethValue === 0 || ethValue === null) return '—'
    const usdValue = ethValue * usdPrice

    if (usdValue < 0.001) {
      const usdInfo = formatPriceMetaMask(usdValue)
      if (usdInfo.type === 'metamask') {
        return (
          <span>
            ${usdInfo.value}
            <sub className="text-xs font-normal" style={{ fontSize: '0.72em' }}>
              {usdInfo.zeros}
            </sub>
            {usdInfo.digits}
          </span>
        )
      }
      return `$${usdInfo.value}`
    }

    if (usdValue >= 1000) {
      return `$${formatLargeNumber(usdValue)}`
    }

    if (usdValue >= 0.1) {
      return `$${usdValue.toFixed(2)}`
    } else if (usdValue >= 0.01) {
      return `$${usdValue.toFixed(3)}`
    } else {
      return `$${usdValue.toFixed(4)}`
    }
  }

  // Fetch holders data
  const fetchHolders = useCallback(async (page: number = 1) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/holders?tokenId=${tokenId}&page=${page}&pageSize=${pageSize}`)
      const data = await response.json()
      
      if (data.success) {
        setHolders(data.holders)
        setCurrentPage(data.currentPage)
        setTotalPages(data.totalPages)
        setTotalCount(data.totalCount)
        setTotalSupply(data.totalSupply)
      }
    } catch (error) {
      console.error('Error fetching holders:', error)
    } finally {
      setIsLoading(false)
    }
  }, [tokenId, pageSize])

  useEffect(() => {
    fetchHolders(1)
  }, [fetchHolders])

  // Pagination handlers
  const goToFirstPage = () => fetchHolders(1)
  const goToPrevPage = () => currentPage > 1 && fetchHolders(currentPage - 1)
  const goToNextPage = () => currentPage < totalPages && fetchHolders(currentPage + 1)
  const goToLastPage = () => fetchHolders(totalPages)

  // Calculate percentage for progress bar
  const getMaxAmount = () => {
    return holders.length > 0 ? Math.max(...holders.map(h => h.amount)) : 0
  }

  const getPercentage = (amount: number) => {
    const maxAmount = getMaxAmount()
    return maxAmount > 0 ? (amount / maxAmount) * 100 : 0
  }

  if (isLoading) {
    return (
      <div className="w-full bg-transparent">
        <div className="flex items-center justify-center py-8">
          <div className="text-gray-400">Loading holders...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full bg-transparent">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="py-3 px-2 text-left text-gray-400 font-medium">Rank</th>
              <th className="py-3 px-2 text-left text-gray-400 font-medium">Address</th>
              <th className="py-3 px-2 text-left text-gray-400 font-medium">%</th>
              <th className="py-3 px-2 text-left text-gray-400 font-medium">Amount</th>
              <th className="py-3 px-2 text-left text-gray-400 font-medium">Value</th>
              <th className="py-3 px-2 text-left text-gray-400 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {holders.map((holder, index) => {
              const rank = (currentPage - 1) * pageSize + index + 1
              const percentage = getPercentage(holder.amount)
              const explorerUrl = getExplorerUrl(holder.holder)
              
              return (
                <tr key={holder.id} className="border-b border-gray-800 hover:bg-gray-800/30">
                  <td className="py-3 px-2 text-gray-300">#{rank}</td>
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-2">
                      <span className="text-blue-400 hover:text-blue-300 cursor-pointer">
                        {holder.holder.slice(0, 6)}...{holder.holder.slice(-6)}
                      </span>
                      {holder.holder_name && holder.holder_name !== '[NULL]' && (
                        <span className="text-xs bg-gray-600 text-gray-200 px-2 py-1 rounded">
                          {holder.holder_name}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-2 text-gray-300">
                    {totalSupply > 0 ? (((holder.amount / 1e18) / (totalSupply / 1e18)) * 100).toFixed(2) : '0.00'}%
                  </td>
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-2">
                      <span className="text-white">
                        {formatTokenAmount(holder.amount)}
                      </span>
                      <div className="w-16 h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-white transition-all duration-300"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-gray-300">
                    {formatUSDValue((holder.amount / 1e18) * holder.current_price, holder.price_usd)}
                  </td>
                  <td className="py-3 px-2">
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-white transition-colors"
                      title="View on Explorer"
                    >
                      <ExternalLink size={16} />
                    </a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!isLoading && holders.length > 0 && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={goToFirstPage}
            disabled={currentPage === 1}
            className="p-2 text-gray-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            title="First page"
          >
            <ChevronsLeft size={16} />
          </button>

          <button
            onClick={goToPrevPage}
            disabled={currentPage === 1}
            className="p-2 text-gray-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            title="Previous page"
          >
            <ChevronLeft size={16} />
          </button>

          <span className="px-3 py-1 text-sm text-gray-300">
            Page {currentPage} of {totalPages} ({totalCount} holders)
          </span>

          <button
            onClick={goToNextPage}
            disabled={currentPage === totalPages}
            className="p-2 text-gray-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            title="Next page"
          >
            <ChevronRight size={16} />
          </button>

          <button
            onClick={goToLastPage}
            disabled={currentPage === totalPages}
            className="p-2 text-gray-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            title="Last page"
          >
            <ChevronsRight size={16} />
          </button>
        </div>
      )}

      {!isLoading && holders.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          No holders found for this token.
        </div>
      )}
    </div>
  )
}
