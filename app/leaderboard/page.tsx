// /app/leaderboard/page.tsx
'use client'

import NewestTransactionsLine from '@/components/NewestTransactionsLine'
import LeaderboardForm from '@/components/LeaderboardForm'

export default function LeaderboardPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-800/60 via-black to-purple-800/50 shadow-2xl shadow-green-500/60">
      <NewestTransactionsLine />
      <LeaderboardForm />
    </div>
  )
}

