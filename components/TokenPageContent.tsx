'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import TokenDetailsView from '@/components/TokenDetailsView'
import { Token } from '@/types/token'
import { useFilters } from '@/lib/FiltersContext'
import { chainNamesById } from '@/lib/chains'

export default function TokenPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const selectedParam = searchParams.get('selected')
  const selectedIndex = selectedParam ? Number(selectedParam) : null

  const [tokens, setTokens] = useState<Token[]>([])
  const [selectedToken, setSelectedToken] = useState<Token | null>(null)

  const { search, creatorFilter, statusFilter, sortFilter } = useFilters()
  const { address, chain } = useAccount() // ✅ get `chain` from `useAccount`

  const fetchTokens = useCallback(async () => {
    if (!chain) {
      setTokens([])
      return
    }

    const params = new URLSearchParams({
      search,
      creator: creatorFilter,
      status: statusFilter,
      sort: sortFilter,
      chainId: String(chain.id), // ✅ send chainId to API
    })

    if (creatorFilter !== 'all' && address) {
      params.set('address', address)
    }

    const res = await fetch(`/api/all-tokens?${params.toString()}`)
    const baseTokens: Token[] = await res.json()

    setTokens(baseTokens)
    setSelectedToken(selectedIndex !== null ? baseTokens[selectedIndex] : null)
  }, [search, creatorFilter, statusFilter, sortFilter, selectedIndex, address, chain])

  useEffect(() => {
    fetchTokens()
  }, [fetchTokens])

  const selectToken = (index: number) => {
    router.push(`/?selected=${index}`)
  }

  const backToList = () => {
    router.push('/')
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!tokens.length || selectedToken) return

      if (e.key === 'ArrowDown') {
        const nextIndex = selectedIndex === null ? 0 : Math.min(selectedIndex + 1, tokens.length - 1)
        router.push(`/?selected=${nextIndex}`)
      } else if (e.key === 'ArrowUp') {
        const prevIndex = selectedIndex === null ? tokens.length - 1 : Math.max(selectedIndex - 1, 0)
        router.push(`/?selected=${prevIndex}`)
      } else if (e.key === 'Enter' && selectedIndex !== null) {
        router.push(`/?selected=${selectedIndex}`)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [tokens, selectedIndex, selectedToken, router])

  if (selectedToken) {
    return (
      <div className="min-h-screen bg-[#0d0f1a] p-6">
        <TokenDetailsView token={selectedToken} onBack={backToList} onRefresh={fetchTokens} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0d0f1a] p-4 md:p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {tokens.map((token, index) => (
          <div
            key={token.id}
            onClick={() => selectToken(index)}
            tabIndex={0}
            role="button"
            onKeyDown={(e) => {
              if (e.key === 'Enter') selectToken(index)
            }}
            className={`cursor-pointer rounded-xl p-4 shadow-lg border ${
              selectedIndex === index
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
                  {token.contract_address.slice(0, 6)}...{token.contract_address.slice(-4)}
                </p>
              </div>
            </div>

            <p className="text-sm text-gray-300 mb-2 line-clamp-3">{token.description}</p>

            <div className="text-sm text-gray-400 mb-1">
              Raised:{' '}
              <span className="text-white">
                {Number(token.eth_raised).toFixed(6).replace(/\.?0+$/, '')} ETH
              </span>{' '}
              / {token.raise_target} ETH
            </div>

            <div className="text-sm text-gray-400 mb-1">
              Creator:{' '}
              <span className="text-white">
                {token.creator_wallet.slice(0, 6)}...{token.creator_wallet.slice(-4)}
              </span>
            </div>

            <div className="text-sm text-gray-400 mb-1">
              Max Supply: <span className="text-white">{token.supply}</span>
            </div>

            {token.fdv && (
              <div className="text-sm text-gray-400 mb-1">
                FDV:{' '}
                <span className="text-white">
                  {Number(token.fdv).toFixed(6).replace(/\.?0+$/, '')} ETH
                </span>
              </div>
            )}

            {token.market_cap && (
              <div className="text-sm text-gray-400 mb-1">
                Market Cap:{' '}
                <span className="text-white">
                  {Number(token.market_cap).toFixed(6).replace(/\.?0+$/, '')} ETH
                </span>
              </div>
            )}

            {token.chain_id && (
              <div className="text-sm text-gray-400 mb-1">
                Chain:{' '}
                <span className="text-white">
                  {chainNamesById[token.chain_id] ?? `Chain ID ${token.chain_id}`}
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





