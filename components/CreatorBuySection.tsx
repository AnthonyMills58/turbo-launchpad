'use client'

import { useState, useEffect } from 'react'
import { usePublicClient, useWriteContract } from 'wagmi'
import { ethers } from 'ethers'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { Input } from '@/components/ui/FormInputs'
import { Token } from '@/types/token'
import { useWalletRefresh } from '@/lib/WalletRefreshContext'
import { calculateBuyAmountFromETH } from '@/lib/calculateBuyAmount'
import { useSync } from '@/lib/SyncContext'

export default function CreatorBuySection({
  token,
  onSuccess,
}: {
  token: Token
  onSuccess?: () => void
}) {
  const maxAllowedAmount = Math.max(
    Math.floor(token.supply * 0.2) - (token.lockedAmount ? parseFloat(token.lockedAmount) : 0),
    1
  )
  const { triggerSync } = useSync()
  const [amount, setAmount] = useState<number>(1.0)
  const [price, setPrice] = useState<string>('0')
  const [loadingPrice, setLoadingPrice] = useState(false)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const refreshWallet = useWalletRefresh()

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = parseFloat(e.target.value)
    if (isNaN(val)) val = 1
    if (val < 1) val = 1
    else if (val > maxAllowedAmount) val = maxAllowedAmount
    setAmount(val)
    setShowSuccess(false)
  }

  const fetchPrice = async () => {
    if (!amount || amount <= 0) return
    setShowSuccess(false)
    setLoadingPrice(true)
    setPrice('0')
    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const contract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, signer)
      const amountInt = ethers.parseUnits(amount.toString(), 18)
      const priceBigInt = await contract.getPrice(amountInt)
      setPrice(ethers.formatEther(priceBigInt))
    } catch (err) {
      console.error('Failed to fetch price:', err)
      setPrice('0')
    }
    setLoadingPrice(false)
  }

  const handleBuy = async () => {
    if (!amount || price === '0') return
    setShowSuccess(false)
    setIsPending(true)
    try {
      const amountWei = ethers.parseUnits(amount.toString(), 18)
      const hash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'creatorBuy',
        args: [amountWei],
        value: ethers.parseEther(price),
      })
      setTxHash(hash)
    } catch (err) {
      console.error('Transaction failed:', err)
      setIsPending(false)
    }
  }

  useEffect(() => {
    if (!txHash || !publicClient) return

    const waitForTx = async () => {
      try {
        await publicClient.waitForTransactionReceipt({ hash: txHash })

        setShowSuccess(true)
        setTxHash(null)
        if (refreshWallet) refreshWallet()

        try {
          await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tokenId: token.id,
              contractAddress: token.contract_address,
              chainId: publicClient?.chain.id,
            }),
          })
          triggerSync() // 🔁 frontendowy refresh TokenDetailsView
        } catch (err) {
          console.error('Failed to sync token state:', err)
        }

        if (onSuccess) onSuccess()
      } catch (err) {
        console.error('Tx failed or dropped:', err)
      } finally {
        setIsPending(false)
      }
    }

    waitForTx()
  }, [txHash, publicClient, refreshWallet, onSuccess, token, triggerSync])

  const displayPrice = parseFloat(price).toFixed(8)
  const isBusy = loadingPrice || isPending

  return (
    <div className="flex flex-col flex-grow max-w-xs bg-[#232633] p-4 rounded-lg shadow border border-[#2a2d3a]">
      <h3 className="text-white text-sm font-semibold mb-2">
        Creator Buy & Lock
        <br />
        <span className="text-xs text-gray-400">max {maxAllowedAmount} (20% of maxSupply)</span>
      </h3>

      <div className="flex flex-wrap gap-2 mb-3">
        {[1 / 10000, 1 / 1000, 1 / 100, 1 / 10 ].map((fraction) => {
          const ethAmount = token.raise_target * fraction
          return (
            <button
              key={fraction}
              type="button"
              onClick={async () => {
              setShowSuccess(false)
              try {
                const ethWei = BigInt(Math.floor(ethAmount * 1e18))

                const provider = new ethers.BrowserProvider(window.ethereum)
                const signer = await provider.getSigner()
                const contract = new ethers.Contract(
                  token.contract_address,
                  TurboTokenABI.abi,
                  signer
                )
                const currentPriceWei = await contract.getCurrentPrice()

                const calculated = calculateBuyAmountFromETH(
                  ethWei,                         // ETH in wei
                  BigInt(currentPriceWei.toString()), // on-chain current price in wei
                  BigInt(Math.floor(token.slope))     // slope in wei
                )

                const rounded = Math.min(calculated, maxAllowedAmount)
                const precise = parseFloat(rounded.toFixed(6))

                setAmount(precise)
                setPrice('0')
              } catch (err) {
                console.error('Curve calc error:', err)
              }
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
        label={`Amount to Buy & Lock (1 - ${maxAllowedAmount})`}
        name="amount"
        value={amount}
        onChange={handleAmountChange}
        min={1}
        max={maxAllowedAmount}
        placeholder="e.g. 1.5"
        disabled={isBusy}
      />

      <button
        onClick={fetchPrice}
        disabled={!amount || isBusy}
        className="w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-purple-600 hover:bg-purple-700 text-white mt-2"
      >
        {loadingPrice ? 'Checking price…' : 'Check Price'}
      </button>

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
            {isPending ? 'Processing...' : 'Buy & Lock'}
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























