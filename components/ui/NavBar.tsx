'use client'

import { useRouter, usePathname } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useBalance } from 'wagmi'
import { useRef, useEffect, useState } from 'react'
import { FiSliders } from 'react-icons/fi'
import { FaSearch } from 'react-icons/fa'
//import { MdOutlineFolderOpen } from 'react-icons/md'
import { useFilters } from '@/lib/FiltersContext'
import { HiOutlinePlusCircle } from 'react-icons/hi'



export default function NavBar() {
  const router = useRouter()
  const pathname = usePathname()
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


  // Close filter dropdown on outside click or hover loss
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
    <nav className="w-full bg-[#0d0f1a] text-white shadow-md px-4 py-2 flex flex-wrap items-center justify-between sticky top-0 z-50">
      {/* Left Nav */}
      <div className="flex flex-wrap items-center gap-1 sm:gap-2">
        {/* Logo and Brand */}
        <div className="flex items-center space-x-1">
          <span className="rocket-icon text-2xl sm:text-3xl">🚀</span>
          <button
            onClick={() => router.push('/')}
            className={`turbo-launch-btn font-black text-lg sm:text-2xl leading-none px-1 sm:px-2 py-2 rounded transition-all duration-200 ${
              pathname === '/' 
                ? 'text-orange-300' 
                : 'text-orange-400 hover:text-orange-300'
            }`}
            style={{fontWeight: '900'}}
          >
            <span className="hidden sm:inline">Turbo Launch</span>
            <span className="sm:hidden">Turbo</span>
          </button>
        </div>
        
        {/* Create Token */}
        <button
          onClick={() => router.push('/create')}
          className="px-2 sm:px-4 py-2 rounded-lg font-medium transition-all duration-200 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 hover:shadow-xl text-white text-sm sm:text-base"
        >
          <HiOutlinePlusCircle className="text-sm sm:text-lg inline mr-1 sm:mr-2" />
          <span className="hidden sm:inline">Create Token</span>
          <span className="sm:hidden">Create</span>
        </button>

        {/* Leaderboard */}
        <button
          onClick={() => router.push('/leaderboard')}
          className="px-1 sm:px-2 py-2 rounded flex items-center space-x-1 transition-all duration-200"
        >
          <span className={`transition-colors duration-200 text-sm sm:text-base ${
            pathname === '/leaderboard' 
              ? 'text-white font-medium' 
              : 'text-gray-400 hover:text-white'
          }`}>
            <span className="hidden sm:inline">Leaderboard</span>
            <span className="sm:hidden">Board</span>
          </span>
        </button>
        
        {/* Backers */}
        <button
          onClick={() => router.push('/backers')}
          className="px-1 sm:px-2 py-2 rounded flex items-center space-x-1 transition-all duration-200"
        >
          <span className={`transition-colors duration-200 text-sm sm:text-base ${
            pathname === '/backers' 
              ? 'text-white font-medium' 
              : 'text-gray-400 hover:text-white'
          }`}>Backers</span>
        </button>
        
        {/* Profile */}
        <button
          onClick={() => router.push('/profile')}
          className="px-1 sm:px-2 py-2 rounded flex items-center space-x-1 transition-all duration-200"
        >
          <span className={`transition-colors duration-200 text-sm sm:text-base ${
            pathname === '/profile' 
              ? 'text-white font-medium' 
              : 'text-gray-400 hover:text-white'
          }`}>Profile</span>
        </button>
      </div>


      {/* Search + Filter */}
      <form onSubmit={handleSearchSubmit} className="flex items-center space-x-1 sm:space-x-2 mt-2 sm:mt-0 relative w-full sm:w-auto">
        <input
          type="text"
          placeholder="Search tokens or creators"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          className="px-2 sm:px-3 py-1 rounded bg-[#1A1B23] text-xs sm:text-sm border border-gray-600 focus:outline-none flex-1 sm:flex-none sm:w-48"
        />

        <button type="submit" className="p-1.5 sm:p-2.5 rounded bg-gray-700 hover:bg-gray-600 text-white" title="Search">
          <FaSearch className="w-3 h-3 sm:w-4 sm:h-4" />
        </button>

        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="p-1.5 sm:p-2.5 rounded bg-gray-700 hover:bg-gray-600 text-white"
          title="Filter tokens"
        >
          <FiSliders size={16} className="sm:w-5 sm:h-5" />
        </button>

        {showFilters && (
          <div
            ref={filterRef}
            onMouseLeave={() => setShowFilters(false)}
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
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                setCreatorFilter('all')
                setStatusFilter('all')
                setSortFilter('created_desc')
                setSearch('')
                setInputValue('')
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










