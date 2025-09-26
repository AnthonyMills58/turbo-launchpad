'use client'

import NewestTransactionsLine from '@/components/NewestTransactionsLine'
import BackersForm from '@/components/BackersForm'

export default function BackersPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-800/60 via-black to-purple-800/50 shadow-2xl shadow-green-500/60">
      <NewestTransactionsLine />
      <BackersForm />
    </div>
  )
}