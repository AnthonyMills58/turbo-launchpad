// /app/page.tsx
'use client'

import dynamic from 'next/dynamic'

// Dynamically load the homepage content on the client
const TokenPageContent = dynamic(() => import('@/components/TokenPageContent'), { ssr: false })

export default function HomePage() {
  return <TokenPageContent />
}















