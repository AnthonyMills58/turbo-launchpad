'use client'

import { useState, useEffect } from 'react'
import { useContractWrite } from 'wagmi'
import { ethers } from 'ethers'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { Input } from '@/components/ui/FormInputs'
import { Token } from '@/types/token'

export default function CreatorBuySection({
  token,
  onSuccess,
}: {
  token: Token
  onSuccess?: () => void
}) {
  // Obliczamy maksymalną dozwoloną ilość do zakupu i zablokowania:
  const maxAllowedAmount = Math.max(
    Math.floor(token.supply * 0.2) - (token.lockedAmount ? parseFloat(token.lockedAmount) : 0),
    1
  )

  // Domyślna wartość amount to 1
  const [amount, setAmount] = useState<number>(1)
  const [price, setPrice] = useState<string>('0')
  const [loadingPrice, setLoadingPrice] = useState(false)

  const { writeContract, isPending, isSuccess } = useContractWrite()

  // Obsługa zmiany wartości inputu z ograniczeniem zakresu
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = Number(e.target.value)
    if (isNaN(val)) val = 1

    if (val < 1) val = 1
    else if (val > maxAllowedAmount) val = maxAllowedAmount

    setAmount(val)
  }

  // Pobierz cenę za podaną ilość tokenów
  const fetchPrice = async () => {
    if (!amount || amount <= 0) return
    setLoadingPrice(true)
    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const contract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, signer)

      const amountInt = BigInt(amount)
      const priceBigInt = await contract.getPrice(amountInt)
      const formatted = ethers.formatEther(priceBigInt)

      setPrice(formatted)
    } catch (err) {
      console.error('Failed to fetch price:', err)
      setPrice('0')
    }
    setLoadingPrice(false)
  }

  // Wywołaj buy-lock w smart kontrakcie
  const handleBuy = () => {
    if (!amount || price === '0') return
    const amountInt = BigInt(amount)
    writeContract({
      address: token.contract_address as `0x${string}`,
      abi: TurboTokenABI.abi,
      functionName: 'creatorBuy',
      args: [amountInt],
      value: ethers.parseEther(price),
    })
  }

  // Po udanym buy-lock odśwież dane w rodzicu
  useEffect(() => {
    if (isSuccess && onSuccess) {
      onSuccess()
    }
  }, [isSuccess, onSuccess])

  const displayPrice = parseFloat(price).toFixed(8)

  return (
    <div className="flex flex-col flex-grow max-w-xs bg-[#232633] p-4 rounded-lg shadow border border-[#2a2d3a]">
     <h3 className="text-white text-sm font-semibold mb-2">
      Creator Buy & Lock
      <br />
      <span className="text-xs text-gray-400">max {maxAllowedAmount} (20% of maxSupply)</span>
    </h3>


      <Input
        type="number"
        label={`Amount to Buy & Lock (1 - ${maxAllowedAmount})`}
        name="amount"
        value={amount}
        onChange={handleAmountChange}
        min={1}
        max={maxAllowedAmount}
        placeholder="e.g. 1"
      />

      <button
        onClick={fetchPrice}
        disabled={!amount || loadingPrice}
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
          disabled={isPending}
          className="w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-green-600 hover:bg-green-700 text-white mt-3 text-sm"
        >
          {isPending ? 'Processing...' : 'Buy & Lock'}
        </button>
      )}

      {isSuccess && (
        <div className="mt-3 text-green-400 text-sm text-center">
          ✅ Transaction sent! Check your wallet or explorer.
        </div>
      )}
    </div>
  )
}


















