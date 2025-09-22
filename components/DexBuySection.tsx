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

  const displayPrice = formatValue(Number(price || 0))

  return (
    <div className="flex flex-col flex-grow w-full bg-[#232633]/40 p-4 rounded-lg shadow border border-[#2a2d3a]">
      <h3 className="text-white text-sm font-semibold mb-2">
        <span className="text-sm text-gray-400">
          max <span className="text-green-500">{maxAvailableAmount.toLocaleString()}</span>
        </span>
      </h3>

      <div className="flex flex-wrap gap-2 mb-3">
        {[1 / 1000, 1 / 100, 1 / 10, 1].map((fraction) => {
          const ethAmount = maxAvailableAmount * fraction * (token.current_price || 0)
          return (
            <button
              key={fraction}
              type="button"
              onClick={() => {
                setShowSuccess(false)
                const amount = maxAvailableAmount * fraction
                setAmount(parseFloat(amount.toFixed(2)))
                setPrice('0')
              }}
              className="px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-xs"
            >
              {parseFloat(ethAmount.toFixed(6)).toString()} ETH
            </button>
          )
        })}
      </div>

      <Input
        type="number"
        label={`Amount to Buy `}
        name="amount"
        value={amount}
        onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
        min={1}
        max={maxAvailableAmount}
        placeholder="e.g. 1.5"
        disabled={isBusy}
      />

      {price !== '0' && (
        <>
          <div className="mt-2 text-sm text-gray-300 text-center">
            Total cost: <strong>{displayPrice} ETH</strong>
          </div>

          <button
            onClick={handleBuy}
            disabled={isPending}
            className="w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-green-600 hover:bg-green-700 text-white mt-3 text-sm"
          >
            {isPending ? 'Processing...' : 'Buy Tokens'}
          </button>
        </>
      )}

      {showSuccess && (
        <div className="mt-3 text-green-400 text-sm text-center">
          ✅ Transaction confirmed!
        </div>
      )}
    </div>
  )
}
