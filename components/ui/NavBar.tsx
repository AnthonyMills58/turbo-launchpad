'use client'

import { useRouter } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useBalance } from 'wagmi'
import { useRef, useEffect, useState } from 'react'
import { FiSliders } from 'react-icons/fi'
import { FaSearch } from 'react-icons/fa'
//import { MdOutlineFolderOpen } from 'react-icons/md'
import { AiFillHome } from 'react-icons/ai'
import { useFilters } from '@/lib/FiltersContext'
import { HiOutlinePlusCircle } from 'react-icons/hi'



export default function NavBar() {
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { search, setSearch, creatorFilter, setCreatorFilter, statusFilter, setStatusFilter, sortFilter, setSortFilter } = useFilters()

  const { data: balance, isLoading } = useBalance({
    address,
    query: {
      enabled: !!address,
      refetchInterval: 10_000,
    },
  })
  console.log(balance)

  const filterRef = useRef<HTMLDivElement>(null)
  const [showFilters, setShowFilters] = useState(false)

  const [inputValue, setInputValue] = useState(search || '')

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = inputValue.trim()
    setSearch(trimmed)
    router.push(`/?search=${encodeURIComponent(trimmed)}`)
  }


  // Close filter dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setShowFilters(false)
      }
    }

    if (showFilters) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showFilters])

  return (
    <nav className="w-full bg-[#151827] text-white shadow-md p-4 flex flex-wrap items-center justify-between sticky top-0 z-50">
      {/* Left Nav */}
      <div className="flex items-center space-x-1">
      <button
        onClick={() => router.push('/')}
        className="hover:bg-gray-700 px-2 py-2 rounded flex items-center space-x-1"
      >
        <AiFillHome className="text-xl" />
        <span>Turbo Launch</span>
      </button>
      <button
        onClick={() => router.push('/leaderboard')}
        className="hover:bg-gray-700 px-2 py-2 rounded flex items-center space-x-1"
      >
        <span>Leaderboard</span>
      </button>
      
      <button
        onClick={() => router.push('/portfolio')}
        className="hover:bg-gray-700 px-2 py-2 rounded flex items-center space-x-1"
      >
        <span>Portfolio</span>
      </button>
      <button
        onClick={() => router.push('/profile')}
        className="hover:bg-gray-700 px-2 py-2 rounded flex items-center space-x-1"
      >
        <span>Profile</span>
      </button>

      <button
        onClick={() => router.push('/create')}
        className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white px-4 py-2 rounded-lg font-medium shadow-lg hover:shadow-xl transition-all duration-200"
      >
        <HiOutlinePlusCircle className="text-lg inline mr-2" />
        <span>Create Token</span>
      </button>
  </div>


      {/* Search + Filter */}
      <form onSubmit={handleSearchSubmit} className="flex items-center space-x-2 mt-2 sm:mt-0 relative">
        <input
          type="text"
          placeholder="Search tokens or address"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          className="px-3 py-1 rounded bg-[#1A1B23] text-sm border border-gray-600 focus:outline-none"
        />


        <button type="submit" className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded text-sm" title="Search">
          <FaSearch className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="p-2.5 rounded bg-gray-700 hover:bg-gray-600 text-white"
          title="Filter tokens"
        >
          <FiSliders size={20} />
        </button>

        {showFilters && (
          <div
            ref={filterRef}
            className="absolute top-12 right-0 mt-2 w-64 bg-[#1A1B23] border border-gray-600 rounded-lg shadow-lg p-4 z-50 text-sm space-y-3"
          >
            {/* Creator Filter */}
            <div>
              <label className="block text-gray-400 mb-1">Creator</label>
              <select
                value={creatorFilter}
                onChange={(e) => setCreatorFilter(e.target.value)}
                className="w-full bg-[#151827] border border-gray-500 text-white rounded p-1"
              >
                <option value="all">All</option>
                <option value="mine">My Tokens</option>
                <option value="others">Other Creators</option>
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-gray-400 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full bg-[#151827] border border-gray-500 text-white rounded p-1"
              >
                <option value="all">All</option>
                <option value="in_progress">In Progress</option>
                <option value="graduated">Graduated</option>
                <option value="on_dex">On DEX</option>
              </select>
            </div>

            {/* Sort Filter */}
            <div>
              <label className="block text-gray-400 mb-1">Sort By</label>
              <select
                value={sortFilter}
                onChange={(e) => setSortFilter(e.target.value)}
                className="w-full bg-[#151827] border border-gray-500 text-white rounded p-1"
              >
                <option value="created_desc">Newest</option>
                <option value="created_asc">Oldest</option>
                <option value="name_asc">Name A–Z</option>
                <option value="symbol_asc">Symbol A–Z</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                setCreatorFilter('all')
                setStatusFilter('all')
                setSortFilter('created_desc')
              }}
              className="w-full mt-2 bg-gray-700 hover:bg-gray-600 text-white text-sm py-1 rounded"
            >
              Clear Filters
            </button>
          </div>
        )}
      </form>

      {/* Wallet Info */}
      <div className="flex items-center space-x-3 mt-2 sm:mt-0">
        {isConnected && address ? (
          <span className="text-sm text-gray-300 hidden sm:inline">
            {isLoading ? 'Loading balance...' : ''}
          </span>
        ) : (
          <span className="text-sm text-gray-400 hidden sm:inline">Not Connected</span>
        )}
        <ConnectButton />
      </div>
    </nav>
  )
}










