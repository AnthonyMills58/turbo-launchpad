'use client'

import { useState, useEffect } from 'react'
import { usePublicClient, useWriteContract } from 'wagmi'
import { ethers } from 'ethers'
import type { InterfaceAbi } from 'ethers'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { Input } from '@/components/ui/FormInputs'
import { Token } from '@/types/token'
import { useWalletRefresh } from '@/lib/WalletRefreshContext'
import { useSync } from '@/lib/SyncContext'
import { formatValue } from '@/lib/displayFormats'

const TURBO_ABI_ETHERS = TurboTokenABI.abi as InterfaceAbi

export default function DexBuySection({
  token,
  onSuccess,
}: {
  token: Token
  onSuccess?: () => void
}) {
  const { triggerSync } = useSync()
  const [amount, setAmount] = useState<number>(1.0)
  const [price, setPrice] = useState<string>('0')
  const [loadingPrice, setLoadingPrice] = useState(false)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [maxAvailableAmount, setMaxAvailableAmount] = useState<number>(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const refreshWallet = useWalletRefresh()
  const isBusy = loadingPrice || isPending

  // TODO: Load DEX liquidity and calculate max available amount
  useEffect(() => {
    const loadDexLiquidity = async () => {
      try {
        // TODO: Implement DEX liquidity calculation
        // For now, set a placeholder value
        setMaxAvailableAmount(1000000) // Placeholder
      } catch (err) {
        console.error('Failed to load DEX liquidity:', err)
        setMaxAvailableAmount(0)
      }
    }

    loadDexLiquidity()
  }, [token.contract_address])

  // TODO: Calculate DEX price based on liquidity pools
  useEffect(() => {
    const calculateDexPrice = async () => {
      if (amount <= 0) {
        setPrice('0')
        return
      }

      setLoadingPrice(true)
      setErrorMessage(null)

      try {
        // TODO: Implement DEX price calculation
        // This should query the DEX pool and calculate price based on liquidity
        // For now, use a placeholder calculation
        const placeholderPrice = token.current_price || 0
        const totalCost = amount * placeholderPrice
        setPrice(totalCost.toFixed(6))
      } catch (err) {
        console.error('Failed to calculate DEX price:', err)
        setErrorMessage('Failed to calculate price')
        setPrice('0')
      } finally {
        setLoadingPrice(false)
      }
    }

    calculateDexPrice()
  }, [amount, token.current_price])

  const handleBuy = async () => {
    if (isBusy || amount <= 0) return

    setIsPending(true)
    setErrorMessage(null)

    try {
      // TODO: Implement DEX buy transaction
      // This should interact with the DEX router/swap contract
      // For now, show a placeholder message
      console.log('DEX Buy transaction would be executed here')
      console.log(`Amount: ${amount} ${token.symbol}`)
      console.log(`Price: ${price} ETH`)
      
      // Placeholder success
      setTxHash('0x1234567890abcdef' as `0x${string}`)
      setShowSuccess(true)
      
      // Trigger refresh
      await refreshWallet()
      triggerSync()
      
      if (onSuccess) {
        onSuccess()
      }
    } catch (err: any) {
      console.error('DEX Buy failed:', err)
      setErrorMessage(err.message || 'Transaction failed')
    } finally {
      setIsPending(false)
    }
  }

  const handleMax = () => {
    setAmount(maxAvailableAmount)
  }

  return (
    <div className="w-full bg-[#04140A]/40 border border-gray-600 rounded-lg p-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white mb-2">DEX Buy</h3>
        <p className="text-sm text-gray-400">
          Buy {token.symbol} tokens directly from DEX liquidity pools
        </p>
      </div>

      <div className="space-y-4">
        {/* Amount Input */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Amount ({token.symbol})
          </label>
          <div className="relative">
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
              placeholder="Enter amount"
              className="pr-20"
              disabled={isBusy}
            />
            <button
              onClick={handleMax}
              disabled={isBusy || maxAvailableAmount <= 0}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              MAX
            </button>
          </div>
          <div className="mt-1 text-xs text-gray-400">
            Max available: {formatValue(maxAvailableAmount)} {token.symbol}
          </div>
        </div>

        {/* Price Display */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Total Cost (ETH)
          </label>
          <div className="p-3 bg-[#04140A] border border-gray-600 rounded text-white">
            {loadingPrice ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm">Calculating...</span>
              </div>
            ) : (
              <span className="text-lg font-mono">{price}</span>
            )}
          </div>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="p-3 bg-red-900/20 border border-red-500 rounded text-red-400 text-sm">
            {errorMessage}
          </div>
        )}

        {/* Success Message */}
        {showSuccess && (
          <div className="p-3 bg-green-900/20 border border-green-500 rounded text-green-400 text-sm">
            <div className="flex items-center gap-2">
              <span>✅ Transaction successful!</span>
            </div>
            {txHash && (
              <div className="mt-2 text-xs">
                <span className="text-gray-400">Tx Hash: </span>
                <span className="font-mono">{txHash}</span>
              </div>
            )}
          </div>
        )}

        {/* Buy Button */}
        <button
          onClick={handleBuy}
          disabled={isBusy || amount <= 0 || parseFloat(price) <= 0}
          className="w-full py-3 px-4 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Processing...</span>
            </div>
          ) : (
            `Buy ${formatValue(amount)} ${token.symbol}`
          )}
        </button>

        {/* Info */}
        <div className="text-xs text-gray-400 space-y-1">
          <div>• DEX trading with real-time liquidity</div>
          <div>• Price may vary based on pool depth</div>
          <div>• Slippage protection included</div>
        </div>
      </div>
    </div>
  )
}
