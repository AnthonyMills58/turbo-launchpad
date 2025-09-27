'use client'

import { useState, useEffect } from 'react'
import { Copy, Check, ArrowLeft } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'

type BackerDetailsViewProps = {
  wallet: string
  onBack: () => void
}

type BackerData = {
  wallet: string
  display_name?: string | null
  bio?: string | null
  avatar_asset_id?: string | null
  portfolio_eth: number
  tokens_held: number
  tokens_created: number
  created_graduated: number
  eth_price_usd: number
}

type CreatedToken = {
  id: number
  symbol: string
  name: string
  current_price: number
  market_cap: number
  volume_24h_eth?: number
  token_logo_asset_id?: string
  image?: string
  created_at: string
  is_graduated: boolean
  on_dex: boolean
}

type HeldToken = {
  token_id: number
  symbol: string
  name: string
  amount: number
  value_eth: number
  logoUrl?: string
}

const shortAddr = (a: string) => (a?.length >= 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '')

// MetaMask-style formatting function
const formatValue = (value: number | string | null | undefined) => {
  const numValue = parseFloat(String(value || 0))
  if (!isFinite(numValue)) return '—'
  
  // Handle zero
  if (numValue === 0) return '0'
  
  const absValue = Math.abs(numValue)
  
  // Handle very small numbers with subscript zeros (MetaMask style)
  if (absValue < 0.01) {
    const str = numValue.toFixed(18)
    const match = str.match(/^0\.0*(\d+)/)
    if (match) {
      const zeros = str.indexOf(match[1]) - 2 // Count leading zeros after decimal
      const significantDigits = match[1].substring(0, 2) // First 2 significant digits
      const subscriptNumber = zeros.toString().split('').map(digit => 
        ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'][parseInt(digit)]
      ).join('')
      return `0.0${subscriptNumber}${significantDigits}`
    }
  }

  // Handle medium numbers
  if (absValue < 1) {
    return parseFloat(numValue.toFixed(4)).toString()
  }

  // Handle large numbers with K/M/B formatting
  if (absValue >= 1e12) {
    return `${parseFloat((numValue / 1e12).toFixed(2))}T`
  } else if (absValue >= 1e9) {
    return `${parseFloat((numValue / 1e9).toFixed(2))}B`
  } else if (absValue >= 1e6) {
    return `${parseFloat((numValue / 1e6).toFixed(2))}M`
  } else if (absValue >= 1e3) {
    return `${parseFloat((numValue / 1e3).toFixed(2))}K`
  }

  // Default formatting for numbers 1-999 (2 decimal places)
  return parseFloat(numValue.toFixed(2)).toString()
}

const formatDisplayValue = (value: number | string | null | undefined, label: string, ethPriceUsd: number | string | null | undefined) => {
  const numValue = parseFloat(String(value || 0))
  const numEthPrice = parseFloat(String(ethPriceUsd || 1))
  const isEthValue = label.toLowerCase().includes('eth') || label.toLowerCase().includes('portfolio')

  if (isEthValue) {
    const usdValue = numValue * numEthPrice
    return `$${formatValue(usdValue)}`
  }

  return formatValue(numValue)
}


export default function BackerDetailsView({ wallet, onBack }: BackerDetailsViewProps) {
  const [backerData, setBackerData] = useState<BackerData | null>(null)
  const [createdTokens, setCreatedTokens] = useState<CreatedToken[]>([])
  const [heldTokens, setHeldTokens] = useState<HeldToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedAddress, setCopiedAddress] = useState(false)
  const { chain } = useAccount()
  const router = useRouter()

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(wallet)
    setCopiedAddress(true)
    setTimeout(() => setCopiedAddress(false), 1500)
  }

  const handleTokenClick = (tokenId: number) => {
    router.push(`/?selected=${tokenId}`)
  }

  useEffect(() => {
    async function loadBackerData() {
      try {
        setLoading(true)
        
        // Build API params
        const params = new URLSearchParams()
        if (chain?.id) {
          params.set('chainId', chain.id.toString())
        }
        
        // Fetch backer data
        const backerResponse = await fetch(`/api/backers?${params}`)
        if (!backerResponse.ok) {
          throw new Error('Failed to fetch backer data')
        }
        const backers = await backerResponse.json()
        const backer = backers.find((b: BackerData) => b.wallet.toLowerCase() === wallet.toLowerCase())
        
        if (!backer) {
          throw new Error('Backer not found')
        }
        
        setBackerData(backer)
        
        // Fetch created tokens and held tokens
        const [createdResponse, heldResponse] = await Promise.all([
          fetch(`/api/backers/${wallet}/created?${params}`),
          fetch(`/api/backers/${wallet}/held?${params}`)
        ])
        
        if (createdResponse.ok) {
          const created = await createdResponse.json()
          setCreatedTokens(created)
        }
        
        if (heldResponse.ok) {
          const held = await heldResponse.json()
          setHeldTokens(held)
        }
        
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load backer data')
      } finally {
        setLoading(false)
      }
    }

    loadBackerData()
  }, [wallet, chain?.id])

  if (loading) {
    return (
      <div className="w-full bg-transparent p-0 text-white">
        <div className="flex items-center justify-center py-12">
          <div className="text-zinc-400">Loading backer details...</div>
        </div>
      </div>
    )
  }

  if (error || !backerData) {
    return (
      <div className="w-full bg-transparent p-0 text-white">
        <div className="text-center py-12">
          <div className="text-red-400 mb-4">Error: {error || 'Backer not found'}</div>
          <button
            onClick={onBack}
            className="text-sm text-gray-400 transition hover:text-white"
          >
            ← Back to backers
          </button>
        </div>
      </div>
    )
  }

  const name = backerData.display_name || shortAddr(backerData.wallet)
  const avatarUrl = backerData.avatar_asset_id
    ? `/api/media/${backerData.avatar_asset_id}?v=thumb`
    : `https://api.dicebear.com/7.x/identicon/svg?seed=${backerData.wallet}&backgroundColor=0f111a&textColor=9ca3af`

  return (
    <div className="w-full bg-transparent p-0 text-white">
      <div className="mx-auto max-w-[1200px] p-2 sm:p-3 md:p-4">
        {/* Header */}
        <div className="mb-4">
        <button
          onClick={onBack}
          className="mb-4 flex items-center gap-2 text-sm text-gray-400 transition hover:text-white"
        >
          <ArrowLeft size={16} />
          Back to backers
        </button>

        {/* Backer Info */}
        <div className="flex items-start gap-4">
          <div className="relative h-20 w-20 overflow-hidden rounded-lg bg-[#0f111a] ring-1 ring-[#2a2d3a]">
            <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-lg font-semibold">{name}</h1>
              <button
                onClick={handleCopyAddress}
                className="text-gray-400 hover:text-white transition-colors"
              >
                {copiedAddress ? (
                  <Check size={12} className="text-green-400" />
                ) : (
                  <Copy size={12} />
                )}
              </button>
            </div>
            
            <div className="text-xs text-zinc-400 mb-1">{shortAddr(backerData.wallet)}</div>
            
            {backerData.bio && (
              <div className="text-xs text-zinc-300 max-w-2xl">{backerData.bio}</div>
            )}
          </div>
        </div>

      </div>


        {/* Content - Side by side layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Created Tokens */}
        <div>
          <h2 className="text-sm font-semibold mb-3">
            Created Tokens: {backerData?.tokens_created || 0} Graduated: {backerData?.created_graduated || 0}
          </h2>
          {createdTokens.length === 0 ? (
            <div className="text-center py-8 text-zinc-400">
              No created tokens found
            </div>
          ) : (
            <div className="space-y-2">
              {createdTokens
                .sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0))
                .map((token) => {
                  const maxMarketCap = Math.max(...createdTokens.map(t => t.market_cap || 0))
                  const marketCapPercentage = maxMarketCap > 0 ? ((token.market_cap || 0) / maxMarketCap) * 100 : 0
                  return (
                <div 
                  key={token.id} 
                  onClick={() => handleTokenClick(token.id)}
                  className="flex items-center gap-3 p-3 rounded-lg border border-[#2a2d3a] bg-[#1b1e2b] cursor-pointer hover:border-purple-400/50 hover:bg-[#2a2d3a] transition-all duration-200"
                >
                  {/* Token Logo */}
                  <div className="relative h-10 w-10 overflow-hidden rounded-lg bg-[#0f111a] ring-1 ring-[#2a2d3a] flex-shrink-0">
                    {token.token_logo_asset_id ? (
                      <img 
                        src={`/api/media/${token.token_logo_asset_id}?v=thumb`} 
                        alt={token.symbol} 
                        className="h-full w-full object-cover" 
                      />
                    ) : token.image ? (
                      <img 
                        src={token.image} 
                        alt={token.symbol} 
                        className="h-full w-full object-cover" 
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-white font-bold text-sm">
                        {token.symbol[0]}
                      </div>
                    )}
                  </div>
                  
                  {/* Token Info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{token.symbol}</div>
                    {/* Progress bar showing market cap relative to highest */}
                    <div className="mt-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-purple-500 to-cyan-400"
                        style={{ width: `${marketCapPercentage}%` }}
                      ></div>
                    </div>
                  </div>
                  
                  {/* Values */}
                  <div className="flex gap-6 text-right flex-shrink-0">
                    <div className="w-24">
                      <div className="text-[11px] text-zinc-400">Market Cap</div>
                      <div className="text-sm font-medium text-white">
                        {token.market_cap ? `$${formatValue(token.market_cap * (backerData?.eth_price_usd || 1))}` : '—'}
                      </div>
                    </div>
                    <div className="w-20">
                      <div className="text-[11px] text-zinc-400">Price</div>
                      <div className="text-sm font-medium text-white">
                        {token.current_price ? `$${formatValue(token.current_price * (backerData?.eth_price_usd || 1))}` : '—'}
                      </div>
                    </div>
                  </div>
                </div>
                  )
                })}
            </div>
          )}
        </div>

        {/* Tokens Held */}
        <div>
          <h2 className="text-sm font-semibold mb-3">
            Tokens Held: {backerData?.tokens_held || 0} Portfolio: {formatDisplayValue(backerData?.portfolio_eth || 0, 'Portfolio', backerData?.eth_price_usd || 1)}
          </h2>
          {heldTokens.length === 0 ? (
            <div className="text-center py-8 text-zinc-400">
              No held tokens found
            </div>
          ) : (
            <div className="space-y-2">
              {heldTokens.map((holding) => (
                <div 
                  key={holding.token_id} 
                  onClick={() => handleTokenClick(holding.token_id)}
                  className="flex items-center gap-3 p-3 rounded-lg border border-[#2a2d3a] bg-[#1b1e2b] cursor-pointer hover:border-purple-400/50 hover:bg-[#2a2d3a] transition-all duration-200"
                >
                  {/* Token Logo */}
                  <div className="relative h-10 w-10 overflow-hidden rounded-lg bg-[#0f111a] ring-1 ring-[#2a2d3a] flex-shrink-0">
                    {holding.logoUrl ? (
                      <img 
                        src={holding.logoUrl} 
                        alt={holding.symbol} 
                        className="h-full w-full object-cover" 
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-white font-bold text-sm">
                        {holding.symbol[0]}
                      </div>
                    )}
                  </div>
                  
                  {/* Token Info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{holding.symbol}</div>
                    {/* Progress bar showing portfolio percentage */}
                    <div className="mt-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-purple-500 to-cyan-400"
                        style={{ width: `${Math.min((holding.value_eth / (backerData?.portfolio_eth || 1)) * 100, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                  
                  {/* Values */}
                  <div className="flex gap-6 text-right flex-shrink-0">
                    <div className="w-24">
                      <div className="text-[11px] text-zinc-400">Value</div>
                      <div className="text-sm font-medium text-white">
                        ${formatValue(holding.value_eth * (backerData?.eth_price_usd || 1))}
                      </div>
                    </div>
                    <div className="w-20">
                      <div className="text-[11px] text-zinc-400">Amount</div>
                      <div className="text-sm font-medium text-white">
                        {formatValue(holding.amount)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}