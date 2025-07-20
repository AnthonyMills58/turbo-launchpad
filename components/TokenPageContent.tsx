'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import TokenDetailsView from '@/components/TokenDetailsView'
import { Token } from '@/types/token'
import { useFilters } from '@/lib/FiltersContext'
import { chainNamesById } from '@/lib/chains'
import { useSync } from '@/lib/SyncContext'
import { getUsdPrice } from '@/lib/getUsdPrice'
import { CircularProgressbar, buildStyles } from 'react-circular-progressbar'
import 'react-circular-progressbar/dist/styles.css'
import { formatValue } from '@/lib/displayFormats'

export default function TokenPageContent() {
  const [usdPrice, setUsdPrice] = useState<number | null>(null)
  const searchParams = useSearchParams()
  const router = useRouter()
  const selectedSymbol = searchParams.get('selected') // 🔁 now using symbol instead of index

  const [tokens, setTokens] = useState<Token[]>([])
  const [activeToken, setActiveToken] = useState<Token | null>(null)

  const { search, creatorFilter, statusFilter, sortFilter } = useFilters()
  const { address, chain } = useAccount()
  const { refreshKey } = useSync()

  const fetchTokens = useCallback(async () => {
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

      const found = baseTokens.find(t => t.symbol === selectedSymbol)
      setActiveToken(found ?? null)
    } catch (error) {
      console.error('Failed to fetch tokens:', error)
      setTokens([])
      setActiveToken(null)
    }
  }, [search, creatorFilter, statusFilter, sortFilter, address, chain, selectedSymbol])

  useEffect(() => {
    getUsdPrice().then(setUsdPrice)
  }, [])

  useEffect(() => {
    fetchTokens()
  }, [fetchTokens, refreshKey])

  const selectToken = (symbol: string) => {
    router.push(`/?selected=${symbol}`)
  }

  const backToList = () => {
    router.push('/')
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!tokens.length || activeToken) return

      const currentIndex = tokens.findIndex(t => t.symbol === selectedSymbol)

      if (e.key === 'ArrowDown') {
        const next = currentIndex === -1 ? 0 : Math.min(currentIndex + 1, tokens.length - 1)
        router.push(`/?selected=${tokens[next].symbol}`)
      } else if (e.key === 'ArrowUp') {
        const prev = currentIndex === -1 ? tokens.length - 1 : Math.max(currentIndex - 1, 0)
        router.push(`/?selected=${tokens[prev].symbol}`)
      } else if (e.key === 'Enter' && currentIndex !== -1) {
        router.push(`/?selected=${tokens[currentIndex].symbol}`)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [tokens, selectedSymbol, activeToken, router])

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
      <div className="min-h-screen bg-[#0d0f1a] p-6">
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

  return (

    <div className="min-h-screen bg-[#0d0f1a] p-4 md:p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {tokens.map((token) => (
          <div
            key={token.id}
            onClick={() => selectToken(token.symbol)}
            tabIndex={0}
            role="button"
            onKeyDown={(e) => {
              if (e.key === 'Enter') selectToken(token.symbol)
            }}
            className={`cursor-pointer rounded-xl p-4 shadow-lg border ${
             selectedSymbol === token.symbol
                ? 'bg-[#23263a] ring-2 ring-purple-400 border-purple-500'
                : 'bg-[#1b1e2b] border-[#2a2d3a] hover:bg-[#2a2e4a]'
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              {token.image && (
                <img
                  src={token.image}
                  alt={token.name}
                  width={40}
                  height={40}
                  className="rounded-full object-cover"
                  draggable={false}
                />
              )}
              <div>
                <h2 className="font-semibold text-lg text-white">
                  {token.name} ({token.symbol})
                </h2>
                <p className="text-xs text-gray-400 break-all">
                  {token.contract_address.slice(0, 6)}...
                  {token.contract_address.slice(-4)}
                </p>
              </div>
            </div>

            <p className="text-sm text-gray-300 mb-2 line-clamp-3">
              {token.description}
            </p>

            <div className="flex items-center gap-4 mb-2">
              <div className="w-12 h-12">
                 <CircularProgressbar
                    value={
                      Number(token.raise_target) > 0
                        ? Math.min((Number(token.eth_raised) / Number(token.raise_target)) * 100, 999)
                        : 0
                    }
                    text={
                      Number(token.raise_target) === 0 || Number(token.eth_raised) === 0
                        ? '0%'
                        : (Number(token.eth_raised) / Number(token.raise_target)) * 100 < 1
                          ? '<1%'
                          : `${Math.floor((Number(token.eth_raised) / Number(token.raise_target)) * 100)}%`
                    }
                    styles={buildStyles({
                      textSize: '1.8rem',
                      textColor: '#ffffff',
                      pathColor: '#10B981',
                      trailColor: '#374151',
                    })}
                  />

              </div>
              <div className="text-sm text-gray-400 leading-tight">
                Raised:{' '}
                <span className="text-white">
                  {Number(token.eth_raised).toFixed(6).replace(/\.?0+$/, '')} ETH
                </span>{' '}
                / {token.raise_target} ETH
              </div>
            </div>

            <div className="text-sm text-gray-400 mb-1">
              Creator:{' '}
              <span className="text-white">
                {token.creator_wallet.slice(0, 6)}...
                {token.creator_wallet.slice(-4)}
              </span>
            </div>

            <div className="text-sm text-gray-400 mb-1">
              Max Supply: <span className="text-white">{Number(token.supply).toLocaleString()}</span>
            </div>

            {token.fdv && (
              <div className="text-sm text-gray-400 mb-1">
                FDV:{' '}
                <span className="text-white">
                   {formatValue(Number(token.fdv))}
                  ETH
                </span>
              </div>
            )}

            {token.on_dex && token.market_cap && (
              <div className="text-sm text-gray-400 mb-1">
                Market Cap:{' '}
                <span className="text-white">
                  {formatValue(Number(token.market_cap))}
                  ETH
                  {usdPrice && (
                    <span className="text-gray-400">
                      {' '}
                      (${(token.market_cap * usdPrice).toFixed(2)})
                    </span>
                  )}
                </span>
              </div>
            )}

            {token.chain_id && (
              <div className="text-sm text-gray-400 mb-1">
                Chain:{' '}
                <span className="text-white">
                  {chainNamesById[token.chain_id] ??
                    `Chain ID ${token.chain_id}`}
                </span>
              </div>
            )}

            {token.created_at && (
              <div className="text-sm text-gray-400 mb-1">
                Created:{' '}
                <span className="text-white">
                  {new Date(token.created_at).toLocaleDateString()}
                </span>
              </div>
            )}

            <div className="text-xs font-medium">
              {token.on_dex ? (
                <span className="text-blue-400">On DEX</span>
              ) : token.is_graduated ? (
                <span className="text-green-400">Graduated</span>
              ) : (
                <span className="text-yellow-400">In Progress</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>

    
  
)

 
}






