'use client'

import { useRouter } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useBalance } from 'wagmi'
import { useState } from 'react'

export default function NavBar() {
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const [search, setSearch] = useState('')

  const { data: balance, isLoading } = useBalance({
    address,
    query: {
      enabled: !!address,
      refetchInterval: 10_000, // optional: refresh balance every 10s
    },
  })
  
  console.log(balance)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (search.trim()) {
      router.push(`/?search=${encodeURIComponent(search.trim())}`)
    }
  }

  return (
    <nav className="w-full bg-[#151827] text-white shadow-md p-4 flex flex-wrap items-center justify-between sticky top-0 z-50">
      {/* Left Nav */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => router.push('/')}
          className="font-bold text-lg hover:text-purple-400"
        >
          Turbo Launchpad
        </button>
        <button
          onClick={() => router.push('/create')}
          className="hover:text-purple-300"
        >
          Create Token
        </button>
      </div>

      {/* Search */}
      <form
        onSubmit={handleSearch}
        className="flex items-center space-x-2 mt-2 sm:mt-0"
      >
        <input
          type="text"
          placeholder="Search tokens or address"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1 rounded bg-[#1A1B23] text-sm border border-gray-600 focus:outline-none"
        />
        <button
          type="submit"
          className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded text-sm"
        >
          Search
        </button>
      </form>

      {/* Wallet Info */}
      <div className="flex items-center space-x-3 mt-2 sm:mt-0">
        {isConnected && address ? (
          <span className="text-sm text-gray-300 hidden sm:inline">
            {isLoading
              ? 'Loading balance...'
              : ``}
          </span>
        ) : (
          <span className="text-sm text-gray-400 hidden sm:inline">
            Not Connected
          </span>
        )}
        <ConnectButton />
      </div>
    </nav>
  )
}




