'use client'

import { useEffect, useState, useCallback } from 'react'
import { usePublicClient, useWriteContract } from 'wagmi'
import { ethers } from 'ethers'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { Input } from '@/components/ui/FormInputs'
import { Token } from '@/types/token'
import { useWalletRefresh } from '@/lib/WalletRefreshContext'
import { useSync } from '@/lib/SyncContext'
import { formatValue } from '@/lib/displayFormats'

export default function DexSellSection({
  token,
  onSuccess,
}: {
  token: Token
  onSuccess?: () => void
}) {
  const { triggerSync } = useSync()
  const [amount, setAmount] = useState<number>(0)
  const [ethReceived, setEthReceived] = useState<string>('0')
  const [loadingPrice, setLoadingPrice] = useState(false)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [maxSellable, setMaxSellable] = useState<number>(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const refreshWallet = useWalletRefresh()
  const isBusy = loadingPrice || isPending

  const fetchBalance = useCallback(async () => {
    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const contract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, signer)
      const balance = await contract.balanceOf(signer.address)
      const formatted = parseFloat(ethers.formatUnits(balance, 18))
      setMaxSellable(formatted)
    } catch (err) {
      console.error('Failed to fetch token balance:', err)
    }
  }, [token.contract_address])

  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])

  // TODO: Calculate DEX sell price based on liquidity pools
  useEffect(() => {
    const calculateDexSellPrice = async () => {
      if (amount <= 0) {
        setEthReceived('0')
        return
      }

      setLoadingPrice(true)
      setErrorMessage(null)

      try {
        // TODO: Implement DEX sell price calculation
        // This should query the DEX pool and calculate ETH received based on liquidity
        // For now, use a placeholder calculation
        const placeholderPrice = token.current_price || 0
        const totalEth = amount * placeholderPrice
        setEthReceived(totalEth.toFixed(6))
      } catch (err) {
        console.error('Failed to calculate DEX sell price:', err)
        setErrorMessage('Failed to calculate sell price')
        setEthReceived('0')
      } finally {
        setLoadingPrice(false)
      }
    }

    calculateDexSellPrice()
  }, [amount, token.current_price])

  const handleSell = async () => {
    if (isBusy || amount <= 0 || amount > maxSellable) return

    setIsPending(true)
    setErrorMessage(null)

    try {
      // TODO: Implement DEX sell transaction
      // This should interact with the DEX router/swap contract
      // For now, show a placeholder message
      console.log('DEX Sell transaction would be executed here')
      console.log(`Amount: ${amount} ${token.symbol}`)
      console.log(`ETH Received: ${ethReceived} ETH`)
      
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
      console.error('DEX Sell failed:', err)
      setErrorMessage(err.message || 'Transaction failed')
    } finally {
      setIsPending(false)
    }
  }

  const handleMax = () => {
    setAmount(maxSellable)
  }

  const handlePercentage = (percentage: number) => {
    const amount = (maxSellable * percentage) / 100
    setAmount(amount)
  }

  return (
    <div className="w-full bg-[#04140A]/40 border border-gray-600 rounded-lg p-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-white mb-2">DEX Sell</h3>
        <p className="text-sm text-gray-400">
          Sell {token.symbol} tokens directly to DEX liquidity pools
        </p>
      </div>

      <div className="space-y-4">
        {/* Balance Display */}
        <div className="p-3 bg-[#04140A] border border-gray-600 rounded">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">Your Balance:</span>
            <span className="text-white font-mono">
              {formatValue(maxSellable)} {token.symbol}
            </span>
          </div>
        </div>

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
              disabled={isBusy || maxSellable <= 0}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              MAX
            </button>
          </div>
        </div>

        {/* Quick Percentage Buttons */}
        <div className="flex gap-2">
          {[25, 50, 75, 100].map((percentage) => (
            <button
              key={percentage}
              onClick={() => handlePercentage(percentage)}
              disabled={isBusy || maxSellable <= 0}
              className="flex-1 py-2 px-3 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {percentage}%
            </button>
          ))}
        </div>

        {/* ETH Received Display */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            ETH Received
          </label>
          <div className="p-3 bg-[#04140A] border border-gray-600 rounded text-white">
            {loadingPrice ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm">Calculating...</span>
              </div>
            ) : (
              <span className="text-lg font-mono">{ethReceived}</span>
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

        {/* Sell Button */}
        <button
          onClick={handleSell}
          disabled={isBusy || amount <= 0 || amount > maxSellable || parseFloat(ethReceived) <= 0}
          className="w-full py-3 px-4 bg-orange-600 text-white font-medium rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isPending ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Processing...</span>
            </div>
          ) : (
            `Sell ${formatValue(amount)} ${token.symbol}`
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
