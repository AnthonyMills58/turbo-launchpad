'use client'

import { useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

type TabType = 'live' | 'new' | 'top' | 'volume'

export default function LeaderboardPage() {
  const [activeTab, setActiveTab] = useState<TabType>('live')
  const searchParams = useSearchParams()
  const router = useRouter()

  // Handle URL tab persistence
  const urlTab = searchParams.get('tab') as TabType
  if (urlTab && ['live', 'new', 'top', 'volume'].includes(urlTab) && urlTab !== activeTab) {
    setActiveTab(urlTab)
  }

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    router.push(`/leaderboard?tab=${tab}`)
  }

  const tabs = [
    { id: 'live' as TabType, label: 'Live' },
    { id: 'new' as TabType, label: 'New' },
    { id: 'top' as TabType, label: 'Top Performers' },
    { id: 'volume' as TabType, label: 'High Volume' },
  ]

  const getTabContent = () => {
    const content = {
      live: {
        title: 'Live Tokens',
        description: 'Real-time trading activity and live price movements'
      },
      new: {
        title: 'New Tokens',
        description: 'Recently launched tokens and fresh opportunities'
      },
      top: {
        title: 'Top Performers',
        description: 'Best performing tokens by price appreciation'
      },
      volume: {
        title: 'High Volume',
        description: 'Tokens with the highest trading volume and liquidity'
      }
    }
    return content[activeTab]
  }

  const currentContent = getTabContent()

  return (
    <div className="min-h-screen bg-[#0d0f1a] p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Leaderboard</h1>
          <p className="text-gray-400">Live • New • Top Performers • High Volume</p>
        </div>

        {/* Tabs */}
        <div className="mb-6">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-[#0d0f1a] ${
                  activeTab === tab.id
                    ? 'bg-purple-600 text-white shadow-lg'
                    : 'bg-transparent text-gray-400 border border-gray-600 hover:border-gray-500 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sort Select */}
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Sort:</label>
            <select 
              className="bg-[#1b1e2b] border border-[#2a2d3a] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              disabled
            >
              <option>24h %</option>
              <option>Volume 24h</option>
              <option>Liquidity</option>
              <option>Newest</option>
            </select>
          </div>
        </div>

        {/* Tab Content */}
        <div className="bg-[#1b1e2b] border border-[#2a2d3a] rounded-xl p-6">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-white mb-2">{currentContent.title}</h2>
            <p className="text-gray-400 text-sm">{currentContent.description}</p>
          </div>

          <div className="mb-4">
            <p className="text-gray-500 text-sm">
              Data coming soon — will connect to trading indexer (charts/volume/holders).
            </p>
          </div>

          {/* Skeleton Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="bg-[#23263a] border border-[#2a2d3a] rounded-lg p-4 animate-pulse"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 bg-gray-700 rounded-lg"></div>
                  <div className="flex-1">
                    <div className="h-4 bg-gray-700 rounded mb-2"></div>
                    <div className="h-3 bg-gray-700 rounded w-2/3"></div>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-3 bg-gray-700 rounded"></div>
                  <div className="h-3 bg-gray-700 rounded w-4/5"></div>
                  <div className="h-3 bg-gray-700 rounded w-3/5"></div>
                </div>
                <div className="mt-4 flex justify-between items-center">
                  <div className="h-6 bg-gray-700 rounded w-16"></div>
                  <div className="h-4 bg-gray-700 rounded w-12"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
