'use client'

import { useNetworkAlert } from '@/hooks/useNetworkAlert'
import PortfolioView from '@/components/PortfolioView'

export default function PortfolioPage() {
  useNetworkAlert()

  return (
    <div className="min-h-screen bg-[#0d0f1a] text-white flex justify-center items-start pt-8 px-2">
      <PortfolioView />
    </div>
  )
}

