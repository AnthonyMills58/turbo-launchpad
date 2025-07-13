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


export default function PublicBuySection({
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

  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const refreshWallet = useWalletRefresh()

  const maxAvailableAmount = token.supply - parseFloat(token.lockedAmount ?? '0') || 1
  const isBusy = loadingPrice || isPending

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = parseFloat(e.target.value)
    if (isNaN(val)) val = 1
    if (val < 1) val = 1
    else if (val > maxAvailableAmount) val = maxAvailableAmount
    setAmount(val)
    setShowSuccess(false)
  }

  const fetchPrice = async () => {
    if (!amount || amount <= 0) return
    setLoadingPrice(true)
    setPrice('0')
    setShowSuccess(false)

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
        functionName: 'buy',
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
          await fetch('/api/update-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contractAddress: token.contract_address }),
          })

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
          console.error('Failed to update or sync token:', err)
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

  return (
    <div className="flex flex-col flex-grow max-w-xs bg-[#232633] p-4 rounded-lg shadow border border-[#2a2d3a]">
      <h3 className="text-white text-sm font-semibold mb-2">
        Public Buy
        <br />
        <span className="text-xs text-gray-400">max {maxAvailableAmount}</span>
      </h3>

      {/* ETH-based preset buttons */}
      <div className="flex flex-wrap gap-2 mb-3">
        {[1 / 10000, 1 / 1000, 1 / 100, 1 / 10].map((fraction) => {
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

                  const calculated2 = calculateBuyAmountFromETH(
                    ethWei,
                    BigInt(currentPriceWei.toString()), // make sure it's bigint
                    BigInt(Math.floor(token.slope))
                  )

                  const rounded = Math.min(calculated2, maxAvailableAmount)
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
        label={`Amount to Buy (1 - ${maxAvailableAmount})`}
        name="amount"
        value={amount}
        onChange={handleAmountChange}
        min={1}
        max={maxAvailableAmount}
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




