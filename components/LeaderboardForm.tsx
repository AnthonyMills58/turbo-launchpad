'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'

// Use the new leaderboard-specific component
const LeaderboardContent = dynamic(() => import('@/components/LeaderboardContent'), { ssr: false })

type TabKey = 'live' | 'new' | 'top' | 'volume' | 'raise'
type Highlight =
  | 'gainers_24h'
  | 'volume_24h'
  | 'liquidity'
  | 'top_raise'
  | 'raise_progress'
  | 'market_cap'
  | 'trades_24h'
  | 'newcomers'

export default function LeaderboardForm() {
  // Visual tabs → you can later reflect this in the URL or FiltersContext if you want
  const [tab, setTab] = useState<TabKey>('live')

  // Map each tab to:
  // - which metric to highlight on the card
  // - whether to exclude graduated tokens (for Top Raise)
  // - which server sort to request (TokenPageContent can forward this in its query)
  const cfg = useMemo(() => {
    switch (tab) {
      case 'live':
        return { highlight: 'gainers_24h' as Highlight, excludeGraduated: false, sort: 'gainers_24h' }
      case 'new':
        return { highlight: 'newcomers'   as Highlight, excludeGraduated: false, sort: 'newcomers' }
      case 'top':
        // "Top Performers" – use Market Cap (DEX-biased but legit); you can switch to FDV if preferred
        return { highlight: 'market_cap'  as Highlight, excludeGraduated: false, sort: 'market_cap' }
      case 'volume':
        return { highlight: 'volume_24h'  as Highlight, excludeGraduated: false, sort: 'volume_24h' }
      case 'raise':
        // Optional fifth tab if you decide to show pre-graduation race
        return { highlight: 'top_raise'   as Highlight, excludeGraduated: true,  sort: 'top_raise' }
      default:
        return { highlight: undefined, excludeGraduated: false, sort: 'gainers_24h' }
    }
  }, [tab])

  return (
    <div className="min-h-screen bg-transparent">
      {/* Header + Tabs */}
      <div className="px-4 md:px-6 pt-1 pb-2">
        <div className="mt-4 flex flex-wrap gap-2 justify-center">
          {([
            ['live',   'Live'],
            ['new',    'New'],
            ['top',    'Top Performers'],
            ['volume', 'High Volume'],
            // Uncomment if you want the pre-grad race tab visible:
            // ['raise',  'Top Raise'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key as TabKey)}
              className={`px-3 py-1.5 rounded text-sm border transition ${
                tab === key
                  ? 'bg-gray-800 text-white border-gray-600'
                  : 'bg-transparent text-gray-300 border-white/0 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Leaderboard-specific token grid with highlighted metrics */}
      {cfg.highlight && (
        <LeaderboardContent
          highlightMetric={cfg.highlight}
          excludeGraduated={cfg.excludeGraduated}
        />
      )}
    </div>
  )
}
