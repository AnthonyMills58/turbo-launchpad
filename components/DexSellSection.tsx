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

  const displayPrice = formatValue(Number(ethReceived || 0))

  return (
    <div className="flex flex-col flex-grow w-full bg-[#232633]/40 p-4 rounded-lg shadow border border-[#2a2d3a]">
      <h3 className="text-white text-sm font-semibold mb-2">
        <span className="text-sm text-gray-400">
          balance <span className="text-green-500">{maxSellable.toLocaleString()}</span>
        </span>
      </h3>

      <div className="flex flex-wrap gap-2 mb-3">
        {[0.25, 0.5, 0.75, 1].map((fraction) => {
          const sellAmount = maxSellable * fraction
          return (
            <button
              key={fraction}
              type="button"
              onClick={() => {
                const value = parseFloat(sellAmount.toFixed(2))
                setAmount(value)
                setShowSuccess(false)
                setEthReceived('0')
                setErrorMessage(null)
              }}
              className="px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-xs"
            >
              {Math.floor(fraction * 100)}%
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => {
            const value = parseFloat(maxSellable.toString())
            setAmount(value)
            setShowSuccess(false)
            setEthReceived('0')
            setErrorMessage(null)
          }}
          className="px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-xs"
        >
          Max
        </button>
      </div>

      <Input
        type="number"
        label={`Amount to Sell `}
        name="sellAmount"
        value={amount}
        onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
        min={0}
        max={maxSellable}
        placeholder="e.g. 10.0"
        disabled={isBusy}
      />

      <button
        onClick={() => {
          // TODO: Implement DEX sell price check
          setLoadingPrice(true)
          setTimeout(() => {
            const totalEth = amount * (token.current_price || 0)
            setEthReceived(totalEth.toFixed(6))
            setLoadingPrice(false)
          }, 1000)
        }}
        disabled={!amount || isBusy}
        className="w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-purple-600 hover:bg-purple-700 text-white mt-2"
      >
        {loadingPrice ? 'Checking price…' : 'Check ETH Received'}
      </button>

      {ethReceived !== '0' && (
        <>
          {!isNaN(Number(displayPrice)) && (
            <div className="mt-2 text-sm text-gray-300 text-center">
              You will receive: <strong>{displayPrice} ETH</strong>
            </div>
          )}

          <button
            onClick={handleSell}
            disabled={isPending}
            className="w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-red-600 hover:bg-red-700 text-white mt-3 text-sm"
          >
            {isPending ? 'Processing...' : 'Sell Tokens'}
          </button>

          {errorMessage && (
            <div className="mt-2 text-sm text-red-400 text-center">
              {errorMessage}
            </div>
          )}
        </>
      )}

      {showSuccess && (
        <div className="mt-3 text-green-400 text-sm text-center">
          ✅ Sell transaction confirmed!
        </div>
      )}
    </div>
  )
}
