'use client'

import { useEffect, useState } from 'react'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { ethers } from 'ethers'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { Token } from '@/types/token'

export default function AirdropClaimForm({ token }: { token: Token }) {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  const [allocation, setAllocation] = useState<number | null>(null)
  const [claimed, setClaimed] = useState<boolean>(false)
  const [isClaiming, setIsClaiming] = useState(false)
  const [success, setSuccess] = useState(false)

  const isGraduated = token.onChainData?.graduated ?? false
  const isCreator = address?.toLowerCase() === token.creator_wallet.toLowerCase()

  useEffect(() => {
    const fetchClaimStatus = async () => {
      if (!address || !isGraduated) return
      try {
        const provider = new ethers.BrowserProvider(window.ethereum)
        const contract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, provider)

        const amt: bigint = await contract.airdropAllocations(address)
        const wasClaimed: boolean = await contract.airdropClaimed(address)

        setAllocation(Number(amt))
        setClaimed(wasClaimed)
      } catch (err) {
        console.error('❌ Failed to fetch airdrop status:', err)
        setAllocation(null)
        setClaimed(false)
      }
    }

    fetchClaimStatus()
  }, [address, token.contract_address, isGraduated])

  const handleClaim = async () => {
    if (!address || !publicClient || !allocation || claimed || isClaiming) return
    setIsClaiming(true)
    setSuccess(false)
    try {
      const txHash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'claimAirdrop',
      })

      await publicClient.waitForTransactionReceipt({ hash: txHash })
      setClaimed(true)
      setSuccess(true)
    } catch (err) {
      console.error('❌ Airdrop claim failed:', err)
    } finally {
      setIsClaiming(false)
    }
  }

  if (!address || isCreator || !isGraduated || allocation === null || allocation === 0) return null

  if (claimed) {
    return (
      <div className="flex flex-col flex-grow max-w-xs bg-[#232633] p-4 rounded-lg shadow border border-[#2a2d3a] mt-4">
        <div className="text-green-400 text-sm font-semibold text-center">
          ✅ {allocation} Airdrop Claimed!
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-grow max-w-xs bg-[#232633] p-4 rounded-lg shadow border border-[#2a2d3a] mt-4">
      <h3 className="text-white text-sm font-semibold mb-2">🎁 Claim Your Airdrop</h3>

      <div className="text-sm text-gray-300 mb-4">
        You have <span className="text-white font-semibold">{allocation}</span> tokens waiting.
      </div>

      <button
        onClick={handleClaim}
        disabled={isClaiming}
        className="w-full py-2 rounded-lg font-semibold transition-colors bg-blue-600 hover:bg-blue-700 text-white text-sm"
      >
        {isClaiming ? 'Claiming...' : '🚀 Claim Airdrop'}
      </button>

      {success && (
        <div className="text-green-400 text-sm text-center mt-3">
          ✅ Success! Tokens have been sent.
        </div>
      )}
    </div>
  )
}

