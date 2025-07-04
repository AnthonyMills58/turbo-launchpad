'use client'

import { useEffect, useState, useCallback } from 'react'
import { ethers } from 'ethers'
import { useAccount } from 'wagmi'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import TokenDetailsView from '@/components/TokenDetailsView'
import { Token } from '@/types/token'
import { useSearchParams, useRouter } from 'next/navigation'

export default function TokenPageContent() {
  const { address } = useAccount()
  const searchParams = useSearchParams()
  const router = useRouter()

  const selectedParam = searchParams.get('selected')
  const selectedIndex = selectedParam ? Number(selectedParam) : null

  const [tokens, setTokens] = useState<Token[]>([])
  const [selectedToken, setSelectedToken] = useState<Token | null>(null)

  const fetchTokens = useCallback(async () => {
    const res = await fetch('/api/all-tokens')
    const baseTokens: Token[] = await res.json()

    if (!address) {
      setTokens(baseTokens)
      setSelectedToken(selectedIndex !== null ? baseTokens[selectedIndex] : null)
      return
    }

    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()

      const tokensWithOnChain = await Promise.all(
        baseTokens.map(async (t) => {
          const contract = new ethers.Contract(t.contract_address, TurboTokenABI.abi, signer)
          try {
            const [locked, tokenInfoRaw] = await Promise.all([
              contract.lockedBalances(address),
              contract.tokenInfo()
            ])
            const lockedAmount = locked.toString()
            const tokenInfo = {
              raiseTarget: Number(ethers.formatEther(tokenInfoRaw._raiseTarget)),
              totalRaised: Number(ethers.formatEther(tokenInfoRaw._totalRaised)),
              basePrice: Number(ethers.formatEther(tokenInfoRaw._basePrice)),
              currentPrice: Number(ethers.formatEther(await contract.getCurrentPrice())),
              graduated: tokenInfoRaw._graduated,
              creatorLockAmount: Number(ethers.formatEther(tokenInfoRaw._creatorLockAmount))
            }
            return { ...t, lockedAmount, onChainData: tokenInfo }
          } catch (error) {
            console.error(`Error fetching on-chain data for ${t.name}:`, error)
            return { ...t, lockedAmount: undefined }
          }
        })
      )

      setTokens(tokensWithOnChain)
      setSelectedToken(selectedIndex !== null ? tokensWithOnChain[selectedIndex] : null)
    } catch (err) {
      console.error('Failed to initialize provider or signer', err)
      setTokens(baseTokens)
      setSelectedToken(selectedIndex !== null ? baseTokens[selectedIndex] : null)
    }
  }, [address, selectedIndex])

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
        <TokenDetailsView
          token={selectedToken}
          onBack={backToList}
          onRefresh={fetchTokens}
        />
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
              Raised: <span className="text-white">
                        {Number(token.eth_raised).toFixed(6).replace(/\.?0+$/, '')} ETH
                      </span> / {token.raise_target} ETH

            </div>

            <div className="text-sm text-gray-400 mb-1">
              Creator:{' '}
              <span className="text-white">
                {token.creator_wallet.slice(0, 6)}...{token.creator_wallet.slice(-4)}
              </span>
            </div>

            <div className="text-sm text-gray-400 mb-1 flex justify-between">
              <span>
                Max Supply: <span className="text-white">{token.supply}</span>
              </span>
            
            </div>

            <div
              className={`text-xs font-medium ${
                token.is_graduated ? 'text-green-400' : 'text-yellow-400'
              }`}
            >
              {token.is_graduated ? 'Graduated' : 'In Progress'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
