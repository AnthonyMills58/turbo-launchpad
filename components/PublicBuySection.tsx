'use client'

import { useState, useEffect } from 'react'
import { usePublicClient, useWriteContract } from 'wagmi'
import { ethers } from 'ethers'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { Input } from '@/components/ui/FormInputs'
import { Token } from '@/types/token'
import { useWalletRefresh } from '@/lib/WalletRefreshContext'

export default function PublicBuySection({
  token,
  onSuccess,
}: {
  token: Token
  onSuccess?: () => void
}) {
  const [amount, setAmount] = useState<number>(1)
  const [price, setPrice] = useState<string>('0')
  const [maxSupply, setMaxSupply] = useState<number>(0)
  const [loadingPrice, setLoadingPrice] = useState(false)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const refreshWallet = useWalletRefresh()

  const isBusy = loadingPrice || isPending

  useEffect(() => {
    const fetchMaxSupplyForSale = async () => {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum)
        const contract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, provider)
        const result = await contract.maxSupplyForSale()
        setMaxSupply(Number(result) / 1e18)
      } catch (err) {
        console.error('Failed to fetch maxSupplyForSale:', err)
      }
    }

    fetchMaxSupplyForSale()
  }, [token.contract_address])

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = Number(e.target.value)
    if (isNaN(val)) val = 1
    if (val < 1) val = 1
    else if (val > maxSupply) val = maxSupply
    setAmount(val)
  }

  const fetchPrice = async () => {
    if (!amount || amount <= 0) return
    setLoadingPrice(true)
    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const contract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, signer)
      const amountInt = BigInt(amount)
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
    setIsPending(true)
    setIsSuccess(false)
    try {
      const amountInt = BigInt(amount)
      const hash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'buy',
        args: [amountInt],
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
        setIsSuccess(true)
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
              chainId: publicClient?.chain.id, // ✅ send active chain
            }),
          })

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
  }, [txHash, publicClient, refreshWallet, onSuccess, token])

  const displayPrice = parseFloat(price).toFixed(8)

  return (
    <div className="flex flex-col flex-grow max-w-xs bg-[#232633] p-4 rounded-lg shadow border border-[#2a2d3a]">
      <h3 className="text-white text-sm font-semibold mb-2">
        Public Buy
        <br />
        <span className="text-xs text-gray-400">Max supply for sale: {maxSupply}</span>
      </h3>

      <Input
        type="number"
        label={`Amount to Buy (1 - ${maxSupply})`}
        name="amount"
        value={amount}
        onChange={handleAmountChange}
        min={1}
        max={maxSupply}
        placeholder="e.g. 1"
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
        <div className="mt-2 text-sm text-gray-300 text-center">
          Total cost: <strong>{displayPrice} ETH</strong>
        </div>
      )}

      {price !== '0' && (
        <button
          onClick={handleBuy}
          disabled={isBusy}
          className="w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-green-600 hover:bg-green-700 text-white mt-3 text-sm"
        >
          {isPending ? 'Processing...' : 'Buy Tokens'}
        </button>
      )}

      {isSuccess && (
        <div className="mt-3 text-green-400 text-sm text-center">
          ✅ Transaction confirmed! You may refresh the page.
        </div>
      )}
    </div>
  )
}



