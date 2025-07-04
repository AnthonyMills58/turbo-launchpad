'use client'

import { useRouter } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import { useState } from 'react'

export default function NavBar() {
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const [search, setSearch] = useState('')

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
        {/* Changed from router.push('/') to reset selected token by navigating to root */}
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
        <span className="text-sm text-gray-400 hidden sm:inline">
          {isConnected && address
            ? ``
            : 'Not Connected'}
        </span>
        <ConnectButton />
      </div>
    </nav>
  )
}


