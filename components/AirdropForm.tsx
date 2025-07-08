'use client'

import { useEffect, useState, useCallback } from 'react'
import { ethers } from 'ethers'
import { usePublicClient, useWriteContract } from 'wagmi'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { Input } from '@/components/ui/FormInputs'
import { Token } from '@/types/token'

type AirdropEntry = {
  address: string
  amount: number
  claimed: boolean
}

export default function AirdropForm({
  token,
  onSuccess,
}: {
  token: Token
  onSuccess?: () => void
}) {
  const [onChainAirdrops, setOnChainAirdrops] = useState<AirdropEntry[]>([])
  const [draftAirdrops, setDraftAirdrops] = useState<{ address: string; amount: number }[]>([])
  const [address, setAddress] = useState('')
  const [amount, setAmount] = useState<number>(0)
  const [isPending, setIsPending] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()

  const isGraduated = token.is_graduated === true

  const fetchAirdrops = useCallback(async () => {
    try {
      const allocations = token.airdrop_allocations
      if (!allocations || typeof allocations !== 'object') {
        setOnChainAirdrops([])
        return
      }

      type AllocationData = { amount: number; claimed: boolean }

      const parsed: AirdropEntry[] = Object.entries(allocations).map(([address, raw]) => {
        const data = raw as AllocationData | number
        const amount =
          typeof data === 'object' && 'amount' in data ? data.amount : (data as number)
        const claimed =
          typeof data === 'object' && 'claimed' in data ? data.claimed : false
        return { address, amount, claimed }
      })

      setOnChainAirdrops(parsed)
    } catch (err) {
      console.error('❌ Failed to load airdrops from DB:', err)
      setOnChainAirdrops([])
    }
  }, [token.airdrop_allocations])

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

        await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenId: token.id,
            contractAddress: token.contract_address,
          }),
        })

        setIsSuccess(true)
        setDraftAirdrops([])
        fetchAirdrops()

        // ✅ Trigger parent refresh (TokenDetailsView)
        onSuccess?.()
      }
    } catch (err) {
      console.error('❌ Failed to submit airdrops:', err)
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="flex flex-col flex-grow max-w-xs bg-[#232633] p-4 rounded-lg shadow border border-[#2a2d3a]">
      {/* 👤 Show title in editable mode */}
      {!isGraduated && (
        <h3 className="text-white text-sm font-semibold mb-2">Airdrop Manager</h3>
      )}

      {/* ➕ Input fields for new entries */}
      {!isGraduated && (
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

      {/* 📝 Pending before submission */}
      {draftAirdrops.length > 0 && !isGraduated && (
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

      {/* ✅ Confirmed airdrops */}
      {onChainAirdrops.length > 0 && (
        <div className="mt-0 text-sm text-gray-300">
          <div className="border-b border-gray-600 pb-1 mb-2 text-white font-semibold">
            Confirmed Airdrops
          </div>
          {onChainAirdrops.map((a, i) => (
            <div key={`onchain-${i}`} className="flex justify-between items-center mb-1">
              <div className="truncate w-32">
                {a.address.slice(0, 6)}...{a.address.slice(-4)}
              </div>
              <div className="flex items-center gap-1 justify-end min-w-[80px]">
                <span className="text-white text-xs">{a.amount}</span>
                {a.claimed ? (
                  <span className="text-green-400 text-xs whitespace-nowrap">✅</span>
                ) : (
                  <span className="text-yellow-400 text-xs whitespace-nowrap">🕗</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {isSuccess && (
        <div className="mt-3 text-green-400 text-sm text-center">
          ✅ Airdrops confirmed on-chain.
        </div>
      )}
    </div>
  )
}






