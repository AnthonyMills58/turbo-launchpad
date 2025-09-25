// /app/leaderboard/page.tsx
'use client'

import dynamic from 'next/dynamic'
import NewestTransactionsLine from '@/components/NewestTransactionsLine'
import { useState } from 'react'

// Reuse the same card grid as on the homepage
const TokenPageContent = dynamic(() => import('@/components/TokenPageContent'), { ssr: false })

export default function LeaderboardPage() {
  // Visual tabs for now; you can later wire them to FiltersContext or query params
  const [tab, setTab] = useState<'live' | 'new' | 'top' | 'volume'>('live')

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-800/60 via-black to-purple-800/50 shadow-2xl shadow-green-500/60">
      <NewestTransactionsLine />
      <div className="min-h-screen bg-transparent">
        {/* Header + Tabs */}
        <div className="px-4 md:px-6 pt-6 pb-2">
        
          <div className="mt-4 flex flex-wrap gap-2">
            {([
              ['live', 'Live'],
              ['new', 'New'],
              ['top', 'Top Performers'],
              ['volume', 'High Volume'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 rounded-full text-sm border transition ${
                  tab === key
                    ? 'bg-purple-600/20 text-purple-300 border-purple-600/40'
                    : 'bg-transparent text-gray-300 border-white/10 hover:border-white/20'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Same token grid/cards as Home */}
        <TokenPageContent />
      </div>
    </div>
  )
}

