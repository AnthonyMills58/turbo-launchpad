'use client'

import { useState } from 'react'
import { usePublicClient, useWriteContract } from 'wagmi'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { useWalletRefresh } from '@/lib/WalletRefreshContext'


export default function WithdrawForm({
  contractAddress,
  onSuccess,
}: {
  contractAddress: string
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
      address: contractAddress as `0x${string}`,
      abi: TurboTokenABI.abi,
      functionName: 'withdraw',
    })

    await publicClient.waitForTransactionReceipt({ hash: txHash })

    // ✅ Refresh the wallet after successful transaction
    if (refreshWallet) refreshWallet()

    await fetch('/api/update-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractAddress }),
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
