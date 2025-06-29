// /app/creator/page.tsx
'use client'

import CreatorBuySection from '@/components/CreatorBuySection'

export default function CreatorPage() {
  return (
    <div className="min-h-screen bg-[#0d0f1a] text-white flex justify-center items-start pt-8 px-2">
      <div className="w-full max-w-xl bg-[#151827] p-4 rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold mb-4 text-center">Creator Buy (Lock)</h1>
        <CreatorBuySection />
      </div>
    </div>
  )
}


