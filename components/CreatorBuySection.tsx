'use client'

import { useEffect, useState } from 'react'
import { useAccount, useContractWrite } from 'wagmi'
import { ethers } from 'ethers'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { Input, Select } from '@/components/ui/FormInputs'

interface Token {
  id: number
  name: string
  symbol: string
  contract_address: string
  raise_target: string
  lockedAmount?: string
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
      const res = await fetch(`/api/tokens?creator=${address.toLowerCase()}`)
      const data = await res.json()
      const baseTokens: Token[] = data.tokens || []

      try {
        const provider = new ethers.BrowserProvider(window.ethereum)
        const signer = await provider.getSigner()

        const tokensWithLocked = await Promise.all(
          baseTokens.map(async (t) => {
            try {
              const contract = new ethers.Contract(t.contract_address, TurboTokenABI.abi, signer)
              const locked = await contract.lockedBalances(address)
              return {
                ...t,
                lockedAmount: locked.toString()
              }
            } catch (err) {
              console.error(`Failed to fetch locked amount for ${t.name}`, err)
              return { ...t, lockedAmount: '0' }
            }
          })
        )

        setTokens(tokensWithLocked)
      } catch (err) {
        console.error('Failed to initialize provider or signer', err)
        setTokens(baseTokens)
      }
    }

    fetchTokens()
  }, [address])

 const fetchPrice = async () => {
  if (!selectedToken || !amount || amount <= 0) return
  setLoadingPrice(true)
  try {
    const provider = new ethers.BrowserProvider(window.ethereum)
    const signer = await provider.getSigner()
    const contract = new ethers.Contract(
      selectedToken.contract_address,
      TurboTokenABI.abi,
      signer
    )

    const amountInt = BigInt(amount) // BigInt("1000000000000000000") // scale by 1e18
    console.log("✅ amountInt (passed to getPrice):", amountInt.toString());
    const priceBigInt = await contract.getPrice(amountInt)
    console.log("🧾 priceBigInt (returned from contract):", priceBigInt.toString());

    const formatted = ethers.formatEther(priceBigInt) // from Wei to ETH
    console.log("💰 formatted (ETH):", formatted);

    setPrice(formatted)
  } catch (err) {
    console.error('Failed to fetch price:', err)
    setPrice('0')
  }
  setLoadingPrice(false)
}


  const { writeContract, isPending, isSuccess } = useContractWrite()

  const handleBuy = () => {
    if (!selectedToken || !amount || price === '0') return
    const amountInt = BigInt(amount)
    writeContract({
      address: selectedToken.contract_address as `0x${string}`,
      abi: TurboTokenABI.abi,
      functionName: 'creatorBuy',
      args: [amountInt],
      value: ethers.parseEther(price),
    })
  }

  const displayPrice = parseFloat(price).toFixed(8)

  return (
    <div className="w-full max-w-xl bg-[#151827] p-4 rounded-lg shadow-lg mx-auto mt-8">
      <div className="space-y-4 text-sm">
        <Select
          label="Select your token"
          name="selectedToken"
          value={selectedToken?.contract_address || ''}
          onChange={(e) => {
            const token = tokens.find((t) => t.contract_address === e.target.value)
            setSelectedToken(token || null)
            setPrice('0')
          }}
          options={tokens.map((t) => ({
            value: t.contract_address,
            label: `${t.name} (${t.symbol}) — ${t.lockedAmount ?? '0'} locked`,
          }))}
        />

        {selectedToken && (
          <>
            <Input
              type="number"
              label="Amount to Buy & Lock"
              name="amount"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="e.g. 100"
            />

            <button
              onClick={fetchPrice}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-lg transition-all disabled:opacity-50"
              disabled={!amount || loadingPrice}
            >
              {loadingPrice ? 'Checking price…' : 'Check Price'}
            </button>
          </>
        )}

        {price !== '0' && (
          <div className="mt-2 text-sm text-gray-300 text-center">
            Total cost: <strong>{displayPrice} ETH</strong>
          </div>
        )}

        {selectedToken && price !== '0' && (
          <button
            onClick={handleBuy}
            className="mt-3 w-full bg-green-600 hover:bg-green-700 text-white py-2 text-sm rounded-lg font-semibold transition-all disabled:opacity-50"
            disabled={isPending}
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
    </div>
  )
}










