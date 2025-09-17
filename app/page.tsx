// /app/page.tsx
'use client'

import dynamic from 'next/dynamic'

// Dynamically load the homepage content on the client
const TokenPageContent = dynamic(() => import('@/components/TokenPageContent'), { ssr: false })

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-800/60 via-black to-purple-800/50 shadow-2xl shadow-green-500/60">
      <TokenPageContent />
    </div>
  )
}















