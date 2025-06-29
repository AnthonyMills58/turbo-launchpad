'use client'

import { useRouter } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'

export default function HomePage() {
  const router = useRouter()
  const { isConnected } = useAccount()

  const navButtonClass =
    'w-full border border-gray-600 bg-[#1A1B23] hover:bg-[#23242d] text-white font-medium py-2 px-4 rounded-lg transition duration-200'

  return (
    <div className="min-h-screen bg-[#0d0f1a] text-white flex justify-center items-start pt-10 px-4">
      <div className="w-full max-w-lg bg-[#151827] p-6 rounded-lg shadow-lg">
        <div className="flex justify-end mb-6">
          <ConnectButton />
        </div>

        <h1 className="text-3xl font-bold mb-6 text-center">Turbo Launchpad</h1>

        {!isConnected ? (
          <p className="text-center text-sm text-gray-400">
            Please connect your wallet to get started.
          </p>
        ) : (
          <div className="space-y-3">
            <button onClick={() => router.push('/create')} className={navButtonClass}>
              Create Token
            </button>
            <button onClick={() => router.push('/creator')} className={navButtonClass}>
              Creator Buy (Lock)
            </button>
            <button onClick={() => router.push('/buy')} className={navButtonClass}>
              Public Buy
            </button>
            <button onClick={() => router.push('/sell')} className={navButtonClass}>
              Sell Token
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

