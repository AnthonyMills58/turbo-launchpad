'use client'

import { useState } from 'react'
import { usePublicClient, useWriteContract } from 'wagmi'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { useWalletRefresh } from '@/lib/WalletRefreshContext'
import { Token } from '@/types/token'

export default function WithdrawForm({
  token,
  onSuccess,
}: {
  token: Token
  onSuccess: () => void
}) {
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const [withdrawing, setWithdrawing] = useState(false)
  const refreshWallet = useWalletRefresh()

  const handleWithdraw = async () => {
    try {
      if (!publicClient) return console.error('No public client')
      setWithdrawing(true)

      const txHash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'withdraw',
      })

      await publicClient.waitForTransactionReceipt({ hash: txHash })

      if (refreshWallet) refreshWallet()

      // 1. Fast DB update
      await fetch('/api/update-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress: token.contract_address }),
      })

      // 2. Full sync from on-chain state
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: token.id,
          contractAddress: token.contract_address,
        }),
      })

      onSuccess()
    } catch (err) {
      console.error('❌ Withdraw failed:', err)
    } finally {
      setWithdrawing(false)
    }
  }

  return (
    <button
      onClick={handleWithdraw}
      disabled={withdrawing}
      className={`w-full px-5 py-2.5 rounded-md font-semibold text-white text-sm transition ${
        withdrawing
          ? 'bg-neutral-700 cursor-not-allowed'
          : 'bg-gradient-to-r from-yellow-500 to-orange-600 hover:brightness-110'
      }`}
    >
      {withdrawing ? 'Withdrawing ETH...' : '💸 Withdraw ETH'}
    </button>
  )
}

