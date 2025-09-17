'use client'

import { useEffect, useState, useCallback, memo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import { Copy, Users } from 'lucide-react'
import TokenDetailsView from '@/components/TokenDetailsView'
import { Token } from '@/types/token'
import { useFilters } from '@/lib/FiltersContext'
import { useSync } from '@/lib/SyncContext'
import { getUsdPrice } from '@/lib/getUsdPrice'
import { formatPriceMetaMask } from '@/lib/ui-utils'
import { formatLargeNumber } from '@/lib/displayFormats'
import LogoContainer from './LogoContainer'
import ExternalImageContainer from './ExternalImageContainer'
import UserProfile from './UserProfile'

// Modern Flaunch-style Token Card Component
const TokenCard = memo(({ 
  token, 
  isSelected, 
  onSelect,
  usdPrice,
  updateHolderCount,
  updatingHolders
}: { 
  token: Token
  isSelected: boolean
  onSelect: (id: string) => void
  usdPrice: number | null
  updateHolderCount: (tokenId: number, contractAddress: string, chainId: number) => void
  updatingHolders: Set<number>
}) => {
  const [copied, setCopied] = useState(false)

  const handleCopyContract = () => {
    navigator.clipboard.writeText(token.contract_address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const getStatusBadge = () => {
    if (token.on_dex) {
      return { text: 'On DEX', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' }
    } else if (token.is_graduated) {
      return { text: 'Graduated', color: 'bg-green-500/20 text-green-400 border-green-500/30' }
    } else {
      return { text: 'In Progress', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' }
    }
  }

  const statusBadge = getStatusBadge()


  // Get numeric price value for USD calculation - use same logic as TokenDetailsView
  const getNumericPrice = (): number => {
    if (token.current_price !== undefined && token.current_price !== null) {
      return Number(token.current_price)
    }
    return 0 // Return 0 if no current_price, same as TokenDetailsView showing "–"
  }

  // Get FDV value - for DEX tokens use token.fdv, for In Progress use eth_raised
  const getFDV = (): number | null => {
    if (token.on_dex && token.fdv !== undefined) {
      // On DEX: use synced FDV from DEX data
      return Number(token.fdv)
    } else if (!token.on_dex) {
      // In Progress: use eth_raised (total funds raised)
      return Number(token.eth_raised) || 0
    }
    return null
  }

  // Get the label for the FDV/Cap field
  const getFDVLabel = (): string => {
    if (token.on_dex) {
      return 'FDV'
    } else {
      return 'Cap'
    }
  }

  // Format USD value using MetaMask style formatting for small values, K/M/B for larger values
  const formatUSDValue = (ethValue: number, usdPrice: number | null) => {
    if (!usdPrice || ethValue === 0 || ethValue === null) return '—'
    const usdValue = ethValue * usdPrice
    
    // For very small values (< $0.001), use MetaMask formatting
    if (usdValue < 0.001) {
      const usdInfo = formatPriceMetaMask(usdValue)
      
      if (usdInfo.type === 'metamask') {
        return (
          <span>
            ${usdInfo.value}<sub className="text-xs font-normal" style={{ fontSize: '0.72em' }}>{usdInfo.zeros}</sub>{usdInfo.digits}
          </span>
        )
      }
      return `$${usdInfo.value}`
    }
    
    // For values >= $1000, use K/M/B formatting
    if (usdValue >= 1000) {
      return `$${formatLargeNumber(usdValue)}`
    }
    
    // For smaller values, use fixed decimal places based on value range
    if (usdValue >= 0.1) {
      return `$${usdValue.toFixed(2)}` // 2 decimal places for values >= $0.1
    } else if (usdValue >= 0.01) {
      return `$${usdValue.toFixed(3)}` // 3 decimal places for values >= $0.01
    } else {
      return `$${usdValue.toFixed(4)}` // 4 decimal places for values >= $0.001
    }
  }

  
  // 24h% - show "--" for now (will be replaced with real data later)
  const change24h = null // No mock data
  const isPositive = false
  console.log(change24h, isPositive)
  
  // Format relative time (e.g., "2 months ago", "3 hours ago")
  const formatRelativeTime = (dateString: string): string => {
    const now = new Date()
    const created = new Date(dateString)
    const diffMs = now.getTime() - created.getTime()
    
    const diffSeconds = Math.floor(diffMs / 1000)
    const diffMinutes = Math.floor(diffSeconds / 60)
    const diffHours = Math.floor(diffMinutes / 60)
    const diffDays = Math.floor(diffHours / 24)
    const diffMonths = Math.floor(diffDays / 30)
    const diffYears = Math.floor(diffDays / 365)
    
    if (diffYears > 0) {
      return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`
    } else if (diffMonths > 0) {
      return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`
    } else if (diffDays > 0) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
    } else if (diffHours > 0) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
    } else if (diffMinutes > 0) {
      return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`
    } else {
      return 'Just now'
    }
  }
  
  const createdTime = token.created_at ? formatRelativeTime(token.created_at) : '—'
  
  return (
    <div
      onClick={() => onSelect(token.id.toString())}
      tabIndex={0}
      role="button"
      aria-label={`View ${token.name} (${token.symbol}) token details`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(token.id.toString())
        }
      }}
      className={`group cursor-pointer rounded-xl p-2 border transition-all duration-300 hover:scale-[1.05] hover:shadow-2xl hover:shadow-purple-500/25 hover:border-purple-400/50 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-[#0d0f1a] ${
        isSelected
          ? 'bg-[#23263a] ring-2 ring-purple-400 border-purple-500'
          : 'bg-[#1b1e2b] border-[#2a2d3a] hover:bg-[#2a2e4a] hover:border-[#3a3d4a]'
      }`}
    >
      {/* Three Section Layout */}
      <div className="flex items-start justify-between mb-3 gap-4">
        {/* Section 1: Image Only */}
        <div className="flex-shrink-0">
          {/* Token Logo */}
          <div>
            {token.token_logo_asset_id ? (
              <LogoContainer
                src={`/api/media/${token.token_logo_asset_id}?v=thumb`}
                alt={token.name}
                baseWidth={80}
                className="rounded-lg"
                draggable={false}
                onError={() => {}}
              />
            ) : token.image ? (
              <ExternalImageContainer
                src={token.image}
                alt={token.name}
                baseWidth={80}
                className="rounded-lg"
                draggable={false}
              />
            ) : (
              <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">
                {token.symbol[0]}
              </div>
            )}
          </div>
          </div>
          
        {/* Section 2: Token Information */}
        <div 
          className="flex-1 min-w-0 flex flex-col justify-center items-center text-center"
          title={token.name}
        >
          {/* Token Symbol */}
          <h3 className="font-semibold text-white truncate w-full">
            {token.symbol}
          </h3>
            {/* Contract Address */}
          <div className="flex items-center gap-2 text-xs text-gray-400 justify-center">
              <span className="font-mono">
                {token.contract_address.slice(0, 6)}...{token.contract_address.slice(-4)}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleCopyContract()
                }}
                className="text-gray-400 hover:text-white transition"
                title="Copy contract address"
              >
                <Copy size={12} />
              </button>
              {copied && (
                <span className="text-green-400 text-xs">Copied!</span>
              )}
            </div>
          {/* On DEX Link - Fourth Line */}
          {token.on_dex && token.dex_listing_url && (
            <a
              href={token.dex_listing_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              title="View on DEX"
              onClick={(e) => {
                e.stopPropagation()
              }}
            >
              On DEX ↗
            </a>
          )}
        </div>

        {/* Section 3: Creator Information */}
        <div className="flex-1 min-w-0 flex flex-col justify-center items-center text-center">
          <UserProfile 
            wallet={token.creator_wallet} 
            showAvatar={false} 
            showName={true} 
            showCreatorLabel={false}
            showTime={true}
            createdTime={createdTime}
            layout="compact"
            centerAlign={true}
          />
        </div>
      </div>

      {/* Stats Grid - Different layout based on token status */}
      <div className="mb-3">
        {/* First row: Price, FDV, and Holders */}
        <div className="grid grid-cols-3 gap-2 mb-2">
          {/* Price */}
          <div className="bg-[#23263a] rounded-lg p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Price</span>
              <div className="text-sm font-semibold text-white text-right">
                <div>
                  {token.current_price !== undefined && token.current_price !== null && usdPrice ? (
                    formatUSDValue(getNumericPrice(), usdPrice)
                  ) : (
                    '—'
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* FDV/Cap */}
          <div className="bg-[#23263a] rounded-lg p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">{getFDVLabel()}</span>
              <div className="text-sm font-semibold text-white text-right">
                <div>
                  {usdPrice && getFDV() !== null ? (
                    formatUSDValue(getFDV()!, usdPrice)
                  ) : (
                    '—'
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Holders */}
          <div 
            className="bg-[#23263a] rounded-lg p-2 cursor-pointer hover:bg-[#2a2e4a] transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              if (token.contract_address && token.chain_id) {
                updateHolderCount(token.id, token.contract_address, token.chain_id)
              }
            }}
            title="Click to refresh holder count"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Users size={12} className="text-gray-400" />
                <span className="text-xs text-gray-400">Holders</span>
              </div>
              <div className="text-sm font-semibold text-white text-right">
                <div>
                  {updatingHolders.has(token.id) ? (
                    <span className="text-gray-400">...</span>
                  ) : token.holder_count !== null && token.holder_count !== undefined ? (
                    token.holder_count.toLocaleString()
                  ) : (
                    '—'
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Second row: Status-specific content */}
        {token.on_dex && token.dex_listing_url ? (
          /* On DEX: Volume + Liquidity in single row */
          <div className="grid grid-cols-2 gap-2">
            {/* Volume Box */}
            <div className="bg-[#23263a] rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Vol <sub className="text-[10px]">24h</sub></span>
                <span className="text-sm font-semibold text-white">
                  {token.volume_24h_eth !== undefined && token.volume_24h_eth !== null && token.volume_24h_eth > 0 && usdPrice ? (
                    formatUSDValue(token.volume_24h_eth, usdPrice)
                  ) : (
                    '—'
                  )}
                </span>
              </div>
            </div>
            
            {/* Liquidity Box */}
            <div className="bg-[#23263a] rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">Liquidity</span>
                <span className="text-sm font-semibold text-white">
                  {token.liquidity_eth !== undefined && token.liquidity_eth !== null && token.liquidity_eth > 0 && usdPrice ? (
                    formatUSDValue(token.liquidity_eth, usdPrice)
                  ) : (
                    '—'
                  )}
                </span>
              </div>
            </div>
          </div>
        ) : token.is_graduated ? (
          <div className="flex justify-center">
            <div className={`px-4 py-2 rounded-full text-sm font-medium border ${statusBadge.color}`}>
              {statusBadge.text}
            </div>
          </div>
        ) : (
          /* In Progress: Flaunch-style progress bar */
          <div className="bg-[#23263a] rounded-lg p-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                {/* Rocket Icon */}
                <div className="w-6 h-6 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 text-purple-400">
                    <path fill="currentColor" d="M12 2.5L8 7h8l-4-4.5zM8 8v6l4 4 4-4V8H8zM10 10h4v2h-4v-2z"/>
                  </svg>
                </div>
                <span className="text-sm font-medium text-white">Graduation Progress</span>
              </div>
              
              {/* Progress percentage on the right */}
              <span className="text-sm font-semibold text-orange-400">
                {token.raise_target && token.eth_raised 
                  ? `${Math.min(Math.floor((Number(token.eth_raised) / Number(token.raise_target)) * 100), 100)}%`
                  : '0%'
                }
              </span>
            </div>
            
            {/* Flaunch-style progress bar with animated stripes */}
            <div className="relative h-3 bg-gray-700 rounded-full overflow-hidden">
                {/* Animated stripes background - covers entire bar */}
                <div 
                  className="absolute inset-0"
                  style={{
                    backgroundImage: `repeating-linear-gradient(
                      -45deg,
                      rgba(100,100,100,0.3) 0px,
                      rgba(100,100,100,0.3) 12px,
                      rgba(255,255,255,0.2) 12px,
                      rgba(255,255,255,0.2) 20px
                    )`,
                    backgroundSize: '20px 20px',
                    animation: 'moveStripes 1.28s linear infinite'
                  }}
                ></div>
                
                {/* Progress fill with gradient */}
                <div 
                  className="relative h-full rounded-full transition-all duration-500 ease-out overflow-hidden"
                  style={{ 
                    width: token.raise_target && token.eth_raised 
                      ? `${Math.min((Number(token.eth_raised) / Number(token.raise_target)) * 100, 100)}%` 
                      : '0%' 
                  }}
                >
                  {/* Solid gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-500 via-blue-500 to-cyan-400 opacity-90"></div>
              </div>
            </div>
          </div>
        )}
      </div>


    </div>
  )
})

TokenCard.displayName = 'TokenCard'

export default function TokenPageContent() {
  const [usdPrice, setUsdPrice] = useState<number | null>(null)
  const searchParams = useSearchParams()
  const router = useRouter()
  const selectedId = searchParams.get('selected') // 🔁 now using token ID instead of symbol
  
  // Debug logging
  console.log('[TokenPageContent] selectedId from URL:', selectedId)

  const [tokens, setTokens] = useState<Token[]>([])
  const [activeToken, setActiveToken] = useState<Token | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [updatingHolders, setUpdatingHolders] = useState<Set<number>>(new Set())

  const { search, creatorFilter, statusFilter, sortFilter } = useFilters()
  const { address, chain } = useAccount()
  const { refreshKey } = useSync()

  const updateHolderCount = useCallback(async (tokenId: number, contractAddress: string, chainId: number) => {
    if (updatingHolders.has(tokenId)) return // Already updating
    
    setUpdatingHolders(prev => new Set(prev).add(tokenId))
    
    try {
      const response = await fetch(`/api/token-holders?tokenId=${tokenId}&contractAddress=${contractAddress}&chainId=${chainId}`)
      if (response.ok) {
        const data = await response.json()
        
        // Update the token in the tokens array
        setTokens(prevTokens => 
          prevTokens.map(token => 
            token.id === tokenId 
              ? { ...token, holder_count: data.holderCount, holder_count_updated_at: data.lastUpdated }
              : token
          )
        )
      }
    } catch (error) {
      console.error('Failed to update holder count:', error)
    } finally {
      setUpdatingHolders(prev => {
        const newSet = new Set(prev)
        newSet.delete(tokenId)
        return newSet
      })
    }
  }, [updatingHolders])

  const fetchTokens = useCallback(async () => {
    setIsLoading(true)
    const params = new URLSearchParams({
      search,
      creator: creatorFilter,
      status: statusFilter,
      sort: sortFilter,
    })

    if (chain?.id) {
      params.set('chainId', String(chain.id))
    }

    if (creatorFilter !== 'all' && address) {
      params.set('address', address)
    }

    try {
      const res = await fetch(`/api/all-tokens?${params.toString()}`)
      const baseTokens: Token[] = await res.json()
      setTokens(baseTokens)

      const found = baseTokens.find(t => t.id.toString() === selectedId)
      console.log('[TokenPageContent] Found token for selectedId:', selectedId, '->', found?.id)
      setActiveToken(found ?? null)
      
      // Fetch holder count for the selected token if it exists
      // DISABLED: Automatic holder count fetching
      // if (found && found.contract_address && found.chain_id) {
      //   updateHolderCount(found.id, found.contract_address, found.chain_id).catch(error => {
      //     console.error('Failed to fetch holder count for selected token:', error)
      //   })
      // }

    } catch (error) {
      console.error('Failed to fetch tokens:', error)
      setTokens([])
      setActiveToken(null)
    } finally {
      setIsLoading(false)
    }
  }, [search, creatorFilter, statusFilter, sortFilter, address, chain, selectedId])

  useEffect(() => {
    getUsdPrice().then(setUsdPrice)
  }, [])

  useEffect(() => {
    fetchTokens()
  }, [fetchTokens, refreshKey])

  const selectToken = async (id: string) => {
    // DISABLED: Automatic holder count fetching
    // Previously: Found token and fetched holder count before navigation
    // Now: Direct navigation without automatic holder count fetching
    
    router.push(`/?selected=${id}`)
  }

  const backToList = () => {
    router.push('/') // Navigate to home without selected parameter
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!tokens.length || activeToken) return

      const currentIndex = tokens.findIndex(t => t.id.toString() === selectedId)

      if (e.key === 'ArrowDown') {
        const next = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, tokens.length - 1)
        router.push(`/?selected=${tokens[next].id}`)
      } else if (e.key === 'ArrowUp') {
        const prev = currentIndex === -1 ? tokens.length - 1 : Math.max(currentIndex - 1, 0)
        router.push(`/?selected=${tokens[prev].id}`)
      } else if (e.key === 'Enter' && currentIndex !== -1) {
        router.push(`/?selected=${tokens[currentIndex].id}`)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [tokens, selectedId, activeToken, router])

  if (activeToken) {
    if (!address) {
      return (
        <div className="min-h-screen bg-[#0d0f1a] p-6 text-white">
          <p className="text-center text-lg mt-20">
            🔒 Please connect your wallet to view token details.
          </p>
        </div>
      )
    }

    return (
      <div className="min-h-screen bg-transparent p-6">
        <TokenDetailsView
          key={refreshKey}
          token={activeToken}
          usdPrice={usdPrice}
          onBack={backToList}
          onRefresh={fetchTokens}
        />
      </div>
    )
  }

  // Skeleton loading component
  const SkeletonCard = () => (
    <div className="bg-[#1b1e2b] border border-[#2a2d3a] rounded-xl p-2 animate-pulse">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-16 h-16 bg-gray-700 rounded-lg"></div>
          <div className="flex-1">
            <div className="h-4 bg-gray-700 rounded mb-2"></div>
            <div className="h-3 bg-gray-700 rounded w-2/3"></div>
          </div>
        </div>
        <div className="w-16 h-6 bg-gray-700 rounded-full"></div>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-gray-700 rounded-lg p-2">
            <div className="h-3 bg-gray-600 rounded mb-1"></div>
            <div className="h-4 bg-gray-600 rounded"></div>
          </div>
        ))}
      </div>
      <div className="bg-gray-700 rounded-lg p-2 mb-3">
        <div className="h-3 bg-gray-600 rounded mb-1"></div>
        <div className="h-4 bg-gray-600 rounded"></div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-700 rounded-full"></div>
          <div className="h-3 bg-gray-700 rounded w-16"></div>
        </div>
        <div className="h-3 bg-gray-700 rounded w-12"></div>
      </div>
    </div>
  )

  // Empty state component
  const EmptyState = () => (
    <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
      <div className="text-6xl mb-4">🔍</div>
      <h3 className="text-xl font-semibold text-white mb-2">No tokens found</h3>
      <p className="text-gray-400 max-w-md">
        No tokens match your filters. Try clearing filters or searching a different term.
      </p>
    </div>
  )

  return (
    <div className="min-h-screen bg-transparent p-4 md:p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-3">
        {isLoading ? (
          // Show skeleton cards while loading
          Array.from({ length: 8 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))
        ) : tokens.length === 0 ? (
          <EmptyState />
        ) : (
          tokens.map((token) => (
            <TokenCard
            key={token.id}
              token={token}
              isSelected={selectedId === token.id.toString()}
              onSelect={selectToken}
              usdPrice={usdPrice}
              updateHolderCount={updateHolderCount}
              updatingHolders={updatingHolders}
            />
          ))
        )}
      </div>
    </div>
)

 
}







