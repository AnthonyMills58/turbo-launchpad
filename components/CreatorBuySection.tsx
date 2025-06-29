'use client'

import { useEffect, useState } from 'react'
import { useAccount, useContractRead, useContractWrite, usePrepareContractWrite } from 'wagmi'
import { ethers } from 'ethers'
import { Input } from '@/components/ui/FormInputs'
import TurboTokenABI from '@/lib/abi/TurboToken.json'

interface Token {
  id: number
  name: string
  symbol: string
  contract_address: string
  raise_target: string
}

export default function CreatorBuySection() {
  const { address } = useAccount()
  const [tokens, setTokens] = useState<Token[]>([])
  const [selectedToken, setSelectedToken] = useState<Token | null>(null)
  const [amount, setAmount] = useState<number>(0)
  const [price, setPrice] = useState<string>('0')
  const [loadingPrice, setLoadingPrice] = useState(false)

  useEffect(() => {
    if (!address) return
    const fetchTokens = async () => {
      const res = await fetch(`/api/tokens?creator=${address}`)
      const data = await res.json()
      setTokens(data.tokens || [])
    }
    fetchTokens()
  }, [address])

  const fetchPrice = async () => {
    if (!selectedToken || !amount) return
    setLoadingPrice(true)
    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const contract = new ethers.Contract(
        selectedToken.contract_address,
        TurboTokenABI,
        await provider.getSigner()
      )
      const priceBigInt = await contract.getPrice(amount)
      setPrice(ethers.formatEther(priceBigInt))
    } catch (err) {
      console.error('Failed to fetch price:', err)
      setPrice('0')
    }
    setLoadingPrice(false)
  }

  const { config } = usePrepareContractWrite({
    address: selectedToken?.contract_address as `0x${string}`,
    abi: TurboTokenABI,
    functionName: 'creatorBuy',
    args: [amount],
    enabled: Boolean(selectedToken && amount > 0 && price !== '0'),
    value: price ? ethers.parseEther(price) : undefined,
  })

  const { write, isLoading, isSuccess } = useContractWrite(config)

  return (
    <div className="max-w-xl mx-auto mt-8 p-4 border rounded-lg">
      <h2 className="text-xl font-bold mb-4">Creator Buy & Lock</h2>

      {/* Token Selector */}
      <select
        className="w-full mb-4 border rounded px-3 py-2"
        onChange={(e) => {
          const token = tokens.find((t) => t.contract_address === e.target.value)
          setSelectedToken(token || null)
          setPrice('0')
        }}
      >
        <option value="">Select your token</option>
        {tokens.map((token) => (
          <option key={token.id} value={token.contract_address}>
            {token.name} ({token.symbol})
          </option>
        ))}
      </select>

      {/* Amount input */}
      {selectedToken && (
        <>
          <Input
            type="number"
            placeholder="Amount to buy & lock"
            value={amount || ''}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <button
            onClick={fetchPrice}
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded"
            disabled={!amount || loadingPrice}
          >
            {loadingPrice ? 'Checking price...' : 'Check Price'}
          </button>
        </>
      )}

      {/* Show price */}
      {price !== '0' && (
        <div className="mt-2 text-sm text-gray-700">
          Total cost: <strong>{price} ETH</strong>
        </div>
      )}

      {/* Buy button */}
      {selectedToken && price !== '0' && (
        <button
          onClick={() => write?.()}
          className="mt-4 w-full px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50"
          disabled={!write || isLoading}
        >
          {isLoading ? 'Processing...' : 'Buy & Lock'}
        </button>
      )}

      {isSuccess && (
        <div className="mt-2 text-green-600 text-sm">
          ✅ Transaction sent! Check your wallet or explorer.
        </div>
      )}
    </div>
  )
}
