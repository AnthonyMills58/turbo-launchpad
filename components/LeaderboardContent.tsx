'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { getUsdPrice } from '@/lib/getUsdPrice'
import { formatLargeNumber } from '@/lib/displayFormats'
import { Token } from '@/types/token'
import { TokenCard } from './TokenPageContent'

type Highlight = 'gainers_24h' | 'volume_24h' | 'liquidity' | 'top_raise' | 'raise_progress' | 'market_cap' | 'trades_24h' | 'newcomers'

// Extended Token type with leaderboard-specific fields
type LeaderboardToken = Token & {
  eth_usd: number
  volume_24h_usd: number
  liquidity_effective_usd: number
  price_change_24h_pct: number | null
  trades_24h: number
  raise_progress_pct: number | null
  market_cap_usd: number | null
}

const getHighlightValue = (token: LeaderboardToken, highlightMetric: Highlight): string => {
  switch (highlightMetric) {
    case 'gainers_24h':
      const priceChange = parseFloat(String(token.price_change_24h_pct || 0))
      return `${Math.round(priceChange)}%`
    case 'volume_24h':
      const volume = parseFloat(String(token.volume_24h_usd || 0))
      return `$${formatLargeNumber(volume)}`
    case 'liquidity':
      const liquidity = parseFloat(String(token.liquidity_effective_usd || 0))
      return `$${formatLargeNumber(liquidity)}`
    case 'top_raise':
      const raised = parseFloat(String(token.eth_raised || 0))
      return `${raised.toFixed(4)} ETH`
    case 'raise_progress':
      const progress = parseFloat(String(token.raise_progress_pct || 0))
      return `${Math.round(progress)}%`
    case 'market_cap':
      const marketCap = parseFloat(String(token.market_cap_usd || 0))
      return `$${formatLargeNumber(marketCap)}`
    case 'trades_24h':
      const trades = parseInt(String(token.trades_24h || 0))
      return trades.toString()
    case 'newcomers':
      return token.created_at && typeof token.created_at === 'string' 
        ? new Date(token.created_at).toLocaleDateString() : 'N/A'
    default:
      return 'N/A'
  }
}

const getHighlightLabel = (highlightMetric: Highlight): string => {
  switch (highlightMetric) {
    case 'gainers_24h': return '24h Change'
    case 'volume_24h': return '24h Volume'
    case 'liquidity': return 'Liquidity'
    case 'top_raise': return 'Raised'
    case 'raise_progress': return 'Progress'
    case 'market_cap': return 'Market Cap'
    case 'trades_24h': return '24h Trades'
    case 'newcomers': return 'Created'
    default: return 'Metric'
  }
}

export default function LeaderboardContent({ 
  highlightMetric, 
  excludeGraduated 
}: { 
  highlightMetric: Highlight
  excludeGraduated: boolean 
}) {
  const [tokens, setTokens] = useState<LeaderboardToken[]>([])
  const [loading, setLoading] = useState(true)
  const [usdPrice, setUsdPrice] = useState<number | null>(null)
  const router = useRouter()
  const { chain } = useAccount()
  const fetchLeaderboardData = useCallback(async () => {
    try {
      setLoading(true)
      const sort = highlightMetric === 'newcomers' ? 'newcomers' : highlightMetric
      const params = new URLSearchParams({
        sort,
        limit: '12',
        excludeGraduated: excludeGraduated.toString()
      })
      
      if (chain?.id) {
        params.set('chainId', chain.id.toString())
      }
      
      const response = await fetch(`/api/leaderboard?${params}`)
      if (response.ok) {
        const data = await response.json()
        setTokens(data.tokens || [])
      }
    } catch (error) {
      console.error('Failed to fetch leaderboard data:', error)
    } finally {
      setLoading(false)
    }
  }, [highlightMetric, excludeGraduated, chain?.id])

  useEffect(() => {
    fetchLeaderboardData()
  }, [fetchLeaderboardData])

  useEffect(() => {
    getUsdPrice().then(setUsdPrice)
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="text-gray-400">Loading leaderboard...</div>
      </div>
    )
  }

  const getBadgeColor = (): string => {
    return 'bg-gray-800/60'
  }

  const getValueColor = (token: LeaderboardToken, highlightMetric: Highlight): string => {
    if (highlightMetric === 'gainers_24h') {
      const priceChange = parseFloat(String(token.price_change_24h_pct || 0))
      if (priceChange > 0) return 'text-green-400'
      if (priceChange < 0) return 'text-red-400'
      return 'text-white'
    }
    return 'text-white'
  }

  return (
    <div className="min-h-screen bg-transparent p-2 sm:p-4 md:p-6">
      <div className="flex justify-center w-full">
        <div className="flex flex-wrap justify-center gap-8 max-w-[1600px]">
          {tokens.map((token) => (
            <div key={token.id} className="bg-transparent">
              {/* Highlighted Metric Badge */}
              <div className="text-center mb-1 flex justify-between gap-2">
                {highlightMetric !== 'newcomers' && (
                  <span className={`${getBadgeColor()} text-xs px-2 py-1 rounded-t font-medium ml-3`}>
                    <span className="text-gray-400">Rank:</span>{' '}
                    <span className="text-white">{tokens.indexOf(token) + 1}</span>
                  </span>
                )}
                <span className={`${getBadgeColor()} text-xs px-2 py-1 rounded-t font-medium mr-3`}>
                  <span className="text-gray-400">{getHighlightLabel(highlightMetric)}:</span>{' '}
                  <span className={getValueColor(token, highlightMetric)}>{getHighlightValue(token, highlightMetric)}</span>
                </span>
              </div>
              
              {/* Original TokenCard */}
              <TokenCard
                token={token}
                isSelected={false}
                onSelect={(id: string) => router.push(`/?selected=${id}`)}
                usdPrice={usdPrice}
              />
            </div>
          ))}
        </div>
      </div>
      
      {tokens.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-400">No tokens found for this leaderboard.</div>
        </div>
      )}
    </div>
  )
}