'use client'

import NewestTransactionsLine from '@/components/NewestTransactionsLine'
import BackersForm from '@/components/BackersForm'

export default function BackersPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-800/60 via-black to-purple-800/50 shadow-2xl shadow-green-500/60">
      <NewestTransactionsLine />
      <div className="min-h-screen bg-transparent">
        {/* Header */}
        <div className="px-4 md:px-6 pt-6 pb-2">
          <h1 className="text-3xl font-bold text-white mb-6">Backers</h1>
        </div>
        
        {/* Backers Content */}
        <div className="px-4 md:px-6">
          <BackersForm />
        </div>
      </div>
    </div>
  )
}
