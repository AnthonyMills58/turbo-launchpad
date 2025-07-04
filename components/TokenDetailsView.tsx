'use client'

import { Token } from '@/types/token'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { useState } from 'react'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import CreatorBuySection from './CreatorBuySection'
import WithdrawForm from './WithdrawForm'
import { Copy } from 'lucide-react'

export default function TokenDetailsView({
  token,
  onBack,
  onRefresh,
}: {
  token: Token
  onBack: () => void
  onRefresh: () => void
}) {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  const [copied, setCopied] = useState(false)
  const [isGraduating, setIsGraduating] = useState(false)
  const [isUnlocking, setIsUnlocking] = useState(false)

  const isCreator = address?.toLowerCase() === token.creator_wallet.toLowerCase()
  const isGraduated = token.onChainData?.graduated ?? false
  const raised = token.onChainData?.totalRaised ?? 0
  const cap = token.onChainData?.raiseTarget ?? 0
  const canGraduate = isCreator && !isGraduated && raised >= cap

  const handleGraduate = async () => {
    try {
      if (!publicClient) return console.error('Public client not available')
      setIsGraduating(true)

      const txHash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'graduate',
      })

      await publicClient.waitForTransactionReceipt({ hash: txHash })
      await fetch('/api/update-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress: token.contract_address }),
      })

      onBack()
    } catch (err) {
      console.error('❌ Graduation failed:', err)
    } finally {
      setIsGraduating(false)
    }
  }

  const handleUnlock = async () => {
    try {
      if (!publicClient) return console.error('Public client not available')
      setIsUnlocking(true)

      const txHash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'unlockCreatorTokens',
      })

      await publicClient.waitForTransactionReceipt({ hash: txHash })
      await fetch('/api/update-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress: token.contract_address }),
      })

      onBack()
    } catch (err) {
      console.error('❌ Unlock failed:', err)
    } finally {
      setIsUnlocking(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(token.contract_address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="max-w-4xl mx-auto mt-6 p-6 bg-[#1b1e2b] rounded-lg shadow-lg text-white">
      <button
        onClick={onBack}
        className="text-sm text-gray-400 hover:text-white transition mb-6"
      >
        ← Back to all tokens
      </button>

      <div className="flex flex-col sm:flex-row gap-6">
        {/* Left side: Image + Basic Info */}
        <div className="flex-shrink-0">
          {token.image ? (
            <img
              src={token.image}
              alt={token.name}
              className="w-24 h-24 rounded-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="w-24 h-24 bg-gray-700 rounded-full flex items-center justify-center text-2xl font-bold">
              {token.symbol[0]}
            </div>
          )}
        </div>

        {/* Right side: Details + Buttons */}
        <div className="flex-grow">
          <h1 className="text-3xl font-bold mb-2">
            {token.name} <span className="text-gray-400">({token.symbol})</span>
          </h1>
          <p className="text-gray-300 mb-6">{token.description}</p>

          {/* Contract Address + Copy */}
          <div className="flex items-center mb-4 space-x-2 font-mono text-sm text-gray-400 select-all">
            <span>Contract:</span>
            <span>
              {token.contract_address.slice(0, 6)}...
              {token.contract_address.slice(-4)}
            </span>
            <button
              onClick={handleCopy}
              title="Copy contract address"
              aria-label="Copy contract address"
              type="button"
              className="text-gray-400 hover:text-white transition"
            >
              <Copy size={16} />
            </button>
            {copied && (
              <span className="text-green-400 ml-2 select-none text-xs">Copied!</span>
            )}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm text-gray-300 mb-6">
            <div>
              <span className="font-semibold text-white">Creator</span>
              <p className="font-mono">
                {token.creator_wallet.slice(0, 6)}...{token.creator_wallet.slice(-4)}
              </p>
            </div>
            <div>
              <span className="font-semibold text-white">Status</span>
              <p
                className={
                  isGraduated
                    ? 'text-green-400 font-semibold'
                    : 'text-yellow-400 font-semibold'
                }
              >
                {isGraduated ? 'Graduated' : 'In Progress'}
              </p>
            </div>
            <div>
              <span className="font-semibold text-white">Raised</span>
              <p>
                {Number(raised).toFixed(6).replace(/\.?0+$/, '')} / {cap} ETH
              </p>
            </div>
            <div>
              <span className="font-semibold text-white">Current Price</span>
              <p>{token.onChainData?.currentPrice?.toFixed(7) ?? '–'} ETH</p>
            </div>
            <div>
              <span className="font-semibold text-white">Max Supply</span>
              <p>{token.supply.toLocaleString()}</p>
            </div>
            <div>
              <span className="font-semibold text-white">Locked by Creator</span>
              <p>{token.lockedAmount ? parseFloat(token.lockedAmount).toFixed(0) : '0'}</p>
            </div>
          </div>

          {/* Creator Buy + Graduate or Unlock */}
          {isCreator && (
            <div className="inline-flex flex-col items-stretch space-y-4">
              {!isGraduated && (
                <>
                  <CreatorBuySection token={token} onSuccess={onRefresh} />
                  {canGraduate && (
                    <button
                      onClick={handleGraduate}
                      disabled={isGraduating}
                      className={`w-full px-5 py-2.5 rounded-md font-semibold text-white text-sm transition ${
                        isGraduating
                          ? 'bg-neutral-700 cursor-not-allowed'
                          : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:brightness-110'
                      }`}
                    >
                      {isGraduating ? 'Graduating...' : '🚀 Graduate Token'}
                    </button>
                  )}
                </>
              )}

              {isGraduated && Number(token.lockedAmount ?? 0) > 0 && (
                <button
                  onClick={handleUnlock}
                  disabled={isUnlocking}
                  className={`w-full px-5 py-2.5 rounded-md font-semibold text-white text-sm transition ${
                    isUnlocking
                      ? 'bg-neutral-700 cursor-not-allowed'
                      : 'bg-gradient-to-r from-green-600 to-blue-600 hover:brightness-110'
                  }`}
                >
                  {isUnlocking ? 'Unlocking...' : '🔓 Unlock Creator Tokens'}
                </button>
              )}

              {isGraduated && Number(raised) > 0 && (
                <WithdrawForm contractAddress={token.contract_address} onSuccess={onRefresh} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}





