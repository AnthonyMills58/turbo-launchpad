'use client'

import { useEffect, useState, useCallback } from 'react'
import { ethers } from 'ethers'
import { usePublicClient, useWriteContract } from 'wagmi'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { Input } from '@/components/ui/FormInputs'
import { Token } from '@/types/token'

export default function AirdropForm({ token }: { token: Token }) {
  const [onChainAirdrops, setOnChainAirdrops] = useState<{ address: string; amount: number }[]>([])
  const [draftAirdrops, setDraftAirdrops] = useState<{ address: string; amount: number }[]>([])
  const [address, setAddress] = useState('')
  const [amount, setAmount] = useState<number>(0)
  const [isPending, setIsPending] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  const isFinalized = token.onChainData?.graduated === true

  const fetchAirdrops = useCallback(async () => {
    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const contract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, provider)
      const [addresses, amounts]: [string[], bigint[]] = await contract.getAirdropAllocations?.()
      const parsed = addresses.map((addr, idx) => ({
        address: addr,
        amount: Number(amounts[idx]),
      }))
      setOnChainAirdrops(parsed)
    } catch (err) {
      console.error('❌ Failed to load airdrops:', err)
      setOnChainAirdrops([])
    }
  }, [token.contract_address])

  useEffect(() => {
    fetchAirdrops()
  }, [fetchAirdrops])

  const handleAdd = () => {
    if (!ethers.isAddress(address) || amount <= 0) return
    setDraftAirdrops((prev) => [...prev, { address, amount }])
    setAddress('')
    setAmount(0)
  }

  const handleRemove = (index: number) => {
    setDraftAirdrops((prev) => {
      const copy = [...prev]
      copy.splice(index, 1)
      return copy
    })
  }

  const handleSubmit = async () => {
    if (draftAirdrops.length === 0) return
    setIsPending(true)
    setIsSuccess(false)
    try {
      const addresses = draftAirdrops.map((a) => a.address)
      const amounts = draftAirdrops.map((a) => BigInt(a.amount))
      const hash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'setAirdropAllocations',
        args: [addresses, amounts],
      })
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash })
        setIsSuccess(true)
        setDraftAirdrops([])
        fetchAirdrops()
      }
    } catch (err) {
      console.error('❌ Failed to submit airdrops:', err)
    } finally {
      setIsPending(false)
    }
  }

  return (
  <div className="flex flex-col flex-grow max-w-xs bg-[#232633] p-4 rounded-lg shadow border border-[#2a2d3a] mt-4">
    {/* 👤 Show title only in editable state (before confirmation) */}
    {!isFinalized && onChainAirdrops.length === 0 && (
      <h3 className="text-white text-sm font-semibold mb-2">
        Airdrop Manager
      </h3>
    )}
    {/* ➕ Show input fields only if NOT finalized AND no confirmed airdrops yet */}
    {!isFinalized && onChainAirdrops.length === 0 && (
      <>
        <Input
          name="recipient"
          type="text"
          label="Recipient Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x..."
        />
        <Input
          name="amount"
          type="number"
          label="Token Amount"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          min={1}
          placeholder="e.g. 1000"
        />
        <button
          onClick={handleAdd}
          className="w-full py-2 rounded-lg font-semibold transition-colors bg-purple-600 hover:bg-purple-700 text-white mt-2 text-sm"
        >
          ➕ Add Airdrop
        </button>
      </>
    )}

    {/* 📝 Show draft airdrops list if any (before confirmation) */}
    {draftAirdrops.length > 0 && !isFinalized && (
      <div className="mt-4 text-sm text-gray-300">
        <div className="border-b border-gray-600 pb-1 mb-2 text-white font-semibold">
          Pending Airdrops
        </div>
        {draftAirdrops.map((a, i) => (
          <div key={`draft-${i}`} className="flex justify-between items-center mb-1">
            <div className="truncate w-36">{a.address}</div>
            <div>{a.amount}</div>
            <button
              onClick={() => handleRemove(i)}
              className="text-red-400 hover:text-red-500 text-xs"
            >
              🗑️
            </button>
          </div>
        ))}
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 bg-green-600 hover:bg-green-700 text-white mt-3 text-sm"
        >
          {isPending ? 'Submitting...' : '🚀 Confirm Airdrops'}
        </button>
      </div>
    )}

    {/* ✅ Show confirmed airdrops (fetched from chain) */}
    {onChainAirdrops.length > 0 && (
      <div className="mt-0 text-sm text-gray-300">
        <div className="border-b border-gray-600 pb-1 mb-2 text-white font-semibold">
          Confirmed Airdrops
        </div>
        {onChainAirdrops.map((a, i) => (
          <div key={`onchain-${i}`} className="flex justify-between items-center mb-1">
            <div className="truncate w-36">{a.address}</div>
            <div>{a.amount}</div>
          </div>
        ))}
      </div>
    )}

    {/* ✅ Success message */}
    {isSuccess && (
      <div className="mt-3 text-green-400 text-sm text-center">
        ✅ Airdrops confirmed on-chain.
      </div>
    )}
  </div>
)
}



