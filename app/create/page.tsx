'use client'

//import { ConnectButton } from '@rainbow-me/rainbowkit'
import CreateTokenForm from '@/components/CreateTokenForm'
import NewestTransactionsLine from '@/components/NewestTransactionsLine'
import { useNetworkAlert } from '@/hooks/useNetworkAlert'

export default function CreateTokenPage() {
  useNetworkAlert()

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-800/60 via-black to-purple-800/50 shadow-2xl shadow-green-500/60">
      <NewestTransactionsLine />
      <div className="min-h-screen bg-transparent text-white flex justify-center items-start pt-8 px-2">
        <div className="w-full max-w-xl bg-transparent p-4 rounded-lg shadow-lg">
          <CreateTokenForm />
        </div>
      </div>
    </div>
  )
}
