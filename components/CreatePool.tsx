'use client'

import { useState } from 'react'
import { Token } from '@/types/token'
import { useAccount, useChainId, useWalletClient } from 'wagmi'
import { createDexPool } from '@/lib/createDexPool'

type CreatePoolProps = {
  token: Token
  onSuccess: () => void
  userEthBalance: number
  userTokenBalance: number
}

export default function CreatePool({
  token,
  onSuccess,
  userEthBalance,
  userTokenBalance,
}: CreatePoolProps) {
  const [ethAmount, setEthAmount] = useState('')
  const [tokenAmount, setTokenAmount] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { address } = useAccount()
  const chainId = useChainId()
  const { data: walletClient } = useWalletClient()

  const ethValue = parseFloat(ethAmount)
  const tokenValue = parseFloat(tokenAmount)

  const isFormInvalid =
    isSubmitting ||
    !ethAmount ||
    !tokenAmount ||
    isNaN(ethValue) ||
    isNaN(tokenValue) ||
    ethValue <= 0 ||
    tokenValue <= 0 ||
    ethValue > userEthBalance ||
    tokenValue > userTokenBalance

  const handleCreatePool = async () => {
    try {
      if (!walletClient || !address || !chainId) {
        console.error('Missing wallet connection')
        return
      }

      setIsSubmitting(true)

      await createDexPool({
        token,
        tokenAmount,
        ethAmount,
        address,
        chainId,
      })

      onSuccess()
    } catch (err) {
      console.error('❌ CreatePool error:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mt-6 border border-gray-700 rounded-lg p-4 bg-gray-900">
      <h2 className="text-white font-semibold text-lg mb-4">Create Pool & Add Liquidity</h2>

      <div className="flex flex-col md:flex-row gap-4">
        {/* Left: Token Input */}
        <div className="w-full md:w-1/2 bg-gray-800 rounded-md p-3 border border-gray-700">
          <label className="block text-sm text-gray-300 mb-1">{token.symbol} Amount</label>
          <input
            type="number"
            value={tokenAmount}
            onChange={(e) => setTokenAmount(e.target.value)}
            placeholder={`Enter amount of ${token.symbol}`}
            className="w-full px-3 py-2 text-sm bg-gray-900 text-white rounded border border-gray-600 focus:outline-none"
          />
          <div className="text-xs text-gray-400 mt-1">
            Balance: {userTokenBalance.toLocaleString()}
            <button
              type="button"
              onClick={() => setTokenAmount(userTokenBalance.toString())}
              className="ml-2 text-blue-400 hover:underline"
            >
              MAX
            </button>
          </div>
          {tokenValue > userTokenBalance && (
            <p className="text-red-400 text-xs mt-1">Insufficient {token.symbol} balance</p>
          )}
        </div>

        {/* Right: ETH Input */}
        <div className="w-full md:w-1/2 bg-gray-800 rounded-md p-3 border border-gray-700">
          <label className="block text-sm text-gray-300 mb-1">ETH Amount</label>
          <input
            type="number"
            value={ethAmount}
            onChange={(e) => setEthAmount(e.target.value)}
            placeholder="Enter ETH amount"
            className="w-full px-3 py-2 text-sm bg-gray-900 text-white rounded border border-gray-600 focus:outline-none"
          />
          <div className="text-xs text-gray-400 mt-1">
            Balance: {userEthBalance}
            <button
              type="button"
              onClick={() => {
                const buffer = 0.0005
                const safeMax = Math.max(userEthBalance - buffer, 0)
                setEthAmount(safeMax.toFixed(6))
              }}
              className="ml-2 text-blue-400 hover:underline"
            >
              MAX
            </button>
          </div>
          {ethValue > userEthBalance && (
            <p className="text-red-400 text-xs mt-1">Insufficient ETH balance</p>
          )}
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleCreatePool}
        disabled={isFormInvalid}
        className={`mt-4 w-full px-5 py-2.5 rounded-md font-semibold text-white text-sm transition ${
          isFormInvalid
            ? 'bg-neutral-700 cursor-not-allowed'
            : 'bg-gradient-to-r from-yellow-500 to-pink-500 hover:brightness-110'
        }`}
      >
        {isSubmitting ? 'Processing...' : `🧪 Create Pool (${token.dex || 'DEX'})`}
      </button>
    </div>
  )
}



