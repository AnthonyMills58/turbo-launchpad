// /app/page.tsx
'use client'

import dynamic from 'next/dynamic'

// Ładujemy TokenPageContent dynamicznie po stronie klienta (CSR)
const TokenPageContent = dynamic(() => import('@/components/TokenPageContent'), { ssr: false })

export default function HomePage() {
  return <TokenPageContent />
}














