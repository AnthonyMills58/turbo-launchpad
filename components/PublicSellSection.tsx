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

export default function PublicSellSection({
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

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = parseFloat(e.target.value.replace(',', '.'))
    if (isNaN(val)) val = 0
    if (val < 0) val = 0
    else if (val > maxSellable) val = maxSellable
    setAmount(val)
    setShowSuccess(false)
    setErrorMessage(null)
    setEthReceived('0')
  }

  const fetchSellPrice = async () => {
    if (!amount || amount <= 0 || isNaN(amount)) return
    setLoadingPrice(true)
    setEthReceived('0')
    setShowSuccess(false)
    setErrorMessage(null)

    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const contract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, signer)
      const amountInt = ethers.parseUnits(amount.toString(), 18)
      const priceBigInt = await contract.getSellPrice(amountInt)
      setEthReceived(ethers.formatEther(priceBigInt))
    } catch (err) {
      console.error('Failed to fetch sell price:', err)
      setEthReceived('0')
    }

    setLoadingPrice(false)
  }

  const handleSell = async () => {
    if (!amount || amount <= 0 || isNaN(amount)) {
      setErrorMessage('Invalid sell amount')
      return
    }

    if (ethReceived === '0') {
      setErrorMessage('Please check price first')
      return
    }

    setShowSuccess(false)
    setIsPending(true)
    setErrorMessage(null)

    try {
      const amountWei = ethers.parseUnits(amount.toString(), 18)
      const hash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'sell',
        args: [amountWei],
      })
      setTxHash(hash)
    } catch (err: unknown) {
      const error = err as Error & { cause?: { message?: string } }

      console.error('Transaction failed:', error)

      let message = 'Sell transaction failed. Check console for details.'

      if (
        error.message?.includes('Contract has insufficient ETH') ||
        error.message?.includes('insufficient') ||
        error.cause?.message?.includes('Contract has insufficient ETH')
      ) {
        message = '❌ Not enough ETH in contract. Try selling a smaller amount.'
      }

      setErrorMessage(message)
      setIsPending(false)
    }
  }

  useEffect(() => {
    if (!txHash || !publicClient) return

    const waitForTx = async () => {
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

        if (receipt.status === 'success') {
          setShowSuccess(true)
          setTxHash(null)

          await fetchBalance()

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
        } else {
          setErrorMessage('❌ Contract has low ETH. Sell less or try later.')
          setTxHash(null)
        }
      } catch (err) {
        console.error('Tx failed or dropped:', err)
      } finally {
        setIsPending(false)
      }
    }

    waitForTx()
  }, [txHash, publicClient, refreshWallet, fetchBalance, onSuccess, token, triggerSync])

  //const displayPrice = parseFloat(ethReceived).toFixed(8)
  const displayPrice = formatValue(Number(ethReceived || 0))

  return (
    <div className="flex flex-col flex-grow w-full bg-[#2b2e3c]/40 p-4 rounded-lg shadow border border-[#2a2d3a] mt-0 gap-1">
      <h3 className="text-white text-sm font-semibold mb-2">
        Public Sell
        <br />
        <span className="text-sm text-gray-400">
          Your Balance: <span className="text-green-500">{maxSellable.toLocaleString()}</span>
        </span>
      </h3>

      <div className="flex flex-wrap gap-2 mb-3">
        {[0.05, 0.10, 0.25].map((fraction) => {
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
        onChange={handleAmountChange}
        min={0}
        max={maxSellable}
        placeholder="e.g. 10.0"
        disabled={isBusy}
      />

      <button
        onClick={fetchSellPrice}
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





