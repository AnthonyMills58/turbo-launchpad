// /app/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { ethers } from 'ethers'
import { useAccount } from 'wagmi'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
type Token = {
  id: number
  name: string
  symbol: string
  description: string
  image: string
  eth_raised: number
  raise_target: number
  contract_address: string
  is_graduated: boolean
  creator_wallet: string
  supply: number
  lockedAmount?: string
}

export default function HomePage() {
  const { address } = useAccount()
  const [tokens, setTokens] = useState<Token[]>([])
  const [_tokensByAddress, setTokensByAddress] = useState<Record<string, Token>>({})

  useEffect(() => {
    const fetchTokens = async () => {
      const res = await fetch('/api/all-tokens')
      const baseTokens: Token[] = await res.json()

      if (!address) {
        setTokens(baseTokens)
        setTokensByAddress(
          Object.fromEntries(baseTokens.map((t) => [t.contract_address, t]))
        )
        return
      }

      try {
        const provider = new ethers.BrowserProvider(window.ethereum)
        const signer = await provider.getSigner()

        const tokensWithLocked = await Promise.all(
          baseTokens.map(async (t) => {
            if (t.creator_wallet.toLowerCase() !== address.toLowerCase()) {
              return { ...t, lockedAmount: undefined }
            }

            try {
              const contract = new ethers.Contract(t.contract_address, TurboTokenABI.abi, signer)
              const locked = await contract.lockedBalances(address)
              return {
                ...t,
                lockedAmount: locked.toString()
              }
            } catch (err) {
              console.error(`Failed to fetch locked amount for ${t.name}`, err)
              return { ...t, lockedAmount: '0' }
            }
          })
        )

        setTokens(tokensWithLocked)
        setTokensByAddress(
          Object.fromEntries(tokensWithLocked.map((t) => [t.contract_address, t]))
        )
      } catch (err) {
        console.error('Failed to initialize provider or signer', err)
        setTokens(baseTokens)
        setTokensByAddress(
          Object.fromEntries(baseTokens.map((t) => [t.contract_address, t]))
        )
      }
    }

    fetchTokens()
  }, [address])

  return (
    <div className="bg-[#0d0f1a] min-h-screen">
      <div className="p-4 md:p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {tokens.map((token) => (
          <div
            key={token.id}
            className="bg-[#1b1e2b] rounded-xl p-4 shadow-lg border border-[#2a2d3a]"
          >
            <div className="flex items-center gap-3 mb-3">
              {token.image && (
                <img
                  src={token.image}
                  alt={token.name}
                  className="w-10 h-10 rounded-full"
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

            <div className="text-sm text-gray-400 mb-1">
              Raised: <span className="text-white">{token.eth_raised} ETH</span> /{' '}
              {token.raise_target} ETH
            </div>

            <div className="text-sm text-gray-400 mb-1">
              Creator: <span className="text-white">
                {token.creator_wallet.slice(0, 6)}...
                {token.creator_wallet.slice(-4)}
              </span>
            </div>

            <div className="text-sm text-gray-400 mb-1 flex justify-between">
              <span>
                Max Supply: <span className="text-white">{token.supply}</span>
              </span>
              {token.lockedAmount !== undefined && (
                <span className="text-red-500">
                  Locked: {parseFloat(token.lockedAmount).toFixed(0)}
                </span>
              )}
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





