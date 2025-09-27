'use client'

import { useParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import BackerDetailsView from '@/components/BackerDetailsView'

export default function BackerPage() {
  const params = useParams()
  const router = useRouter()
  const wallet = params.wallet as string

  const handleBack = () => {
    router.push('/backers')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-800/60 via-black to-purple-800/50 shadow-2xl shadow-green-500/60">
      <div className="mx-auto max-w-6xl p-6">
        <BackerDetailsView wallet={wallet} onBack={handleBack} />
      </div>
    </div>
  )
}
