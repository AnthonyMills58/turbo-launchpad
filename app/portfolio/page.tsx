'use client'

import { useNetworkAlert } from '@/hooks/useNetworkAlert'
import PortfolioView from '@/components/PortfolioView'

export default function PortfolioPage() {
  useNetworkAlert()

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-800/60 via-black to-purple-800/50 shadow-2xl shadow-green-500/60">
      <div className="min-h-screen bg-transparent text-white flex justify-center items-start pt-8 px-2">
        <PortfolioView />
      </div>
    </div>
  )
}

