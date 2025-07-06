'use client'

import { Token } from '@/types/token'
import { useAccount, useChainId, usePublicClient, useWriteContract } from 'wagmi'
import { useState } from 'react'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import CreatorBuySection from './CreatorBuySection'
import WithdrawForm from './WithdrawForm'
import PublicBuySection from './PublicBuySection'
import AirdropForm from './AirdropForm'
import AirdropClaimForm from './AirdropClaimForm'
import { megaethTestnet, megaethMainnet } from '@/lib/chains'

import { Copy } from 'lucide-react'

export default function TokenDetailsView({
  token,
  onBack,
  onRefresh,
}: {
  token: Token
  onBack: () => void
  onRefresh: () => void
}) {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const chainId = useChainId()
  const { writeContractAsync } = useWriteContract()

  const [copied, setCopied] = useState(false)
  const [isGraduating, setIsGraduating] = useState(false)
  const [isUnlocking, setIsUnlocking] = useState(false)

  const isCreator = address?.toLowerCase() === token.creator_wallet.toLowerCase()
  const isGraduated = token.onChainData?.graduated ?? false
  const raised = token.onChainData?.totalRaised ?? 0
  const cap = token.onChainData?.raiseTarget ?? 0
  const canGraduate = isCreator && !isGraduated && raised >= cap

 const explorerBaseUrl =
  chainId === megaethTestnet.id
    ? megaethTestnet.blockExplorers!.default.url
    : megaethMainnet.blockExplorers!.default.url

  const explorerLink = `${explorerBaseUrl}/address/${token.contract_address}`

  const handleGraduate = async () => {
    try {
      if (!publicClient) return console.error('Public client not available')
      setIsGraduating(true)

      const txHash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'graduate',
      })

      await publicClient.waitForTransactionReceipt({ hash: txHash })
      await fetch('/api/update-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress: token.contract_address }),
      })

      onBack()
    } catch (err) {
      console.error('❌ Graduation failed:', err)
    } finally {
      setIsGraduating(false)
    }
  }

  const handleUnlock = async () => {
    try {
      if (!publicClient) return console.error('Public client not available')
      setIsUnlocking(true)

      const txHash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'unlockCreatorTokens',
      })

      await publicClient.waitForTransactionReceipt({ hash: txHash })
      await fetch('/api/update-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress: token.contract_address }),
      })

      onBack()
    } catch (err) {
      console.error('❌ Unlock failed:', err)
    } finally {
      setIsUnlocking(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(token.contract_address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="max-w-4xl mx-auto mt-6 p-6 bg-[#1b1e2b] rounded-lg shadow-lg text-white">
      <button
        onClick={onBack}
        className="text-sm text-gray-400 hover:text-white transition mb-6"
      >
        ← Back to all tokens
      </button>

      <div className="flex flex-col sm:flex-row gap-6">
        {/* Left side: Image + Basic Info */}
        <div className="flex-shrink-0">
          {token.image ? (
            <img
              src={token.image}
              alt={token.name}
              className="w-24 h-24 rounded-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="w-24 h-24 bg-gray-700 rounded-full flex items-center justify-center text-2xl font-bold">
              {token.symbol[0]}
            </div>
          )}
        </div>

        {/* Right side: Details + Buttons */}
        <div className="flex-grow">
          <h1 className="text-3xl font-bold mb-2">
            {token.name} <span className="text-gray-400">({token.symbol})</span>
          </h1>
          <p className="text-gray-300 mb-4">{token.description}</p>

          {/* 🔗 Links */}
          {(token.website || token.twitter || token.telegram) && (
            <div className="mb-4 text-sm">
              <div className="flex flex-wrap gap-4 text-blue-400">
                {token.website && (
                  <a
                    href={token.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline flex items-center gap-1"
                  >
                    🌐 <span className="underline">Website</span>
                  </a>
                )}
                {token.twitter && (
                  <a
                    href={token.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline flex items-center gap-1"
                  >
                    🐦 <span className="underline">Social</span>
                  </a>
                )}
                {token.telegram && (
                  <a
                    href={token.telegram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline flex items-center gap-1"
                  >
                    💬 <span className="underline">Community</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Contract Address + Copy + Explorer Link */}
          <div className="flex items-center flex-wrap mb-4 space-x-2 font-mono text-sm text-gray-400 select-all">
            <span>Contract:</span>
            <span>{token.contract_address.slice(0, 6)}...{token.contract_address.slice(-4)}</span>

            <button
              onClick={handleCopy}
              title="Copy contract address"
              aria-label="Copy contract address"
              type="button"
              className="text-gray-400 hover:text-white transition"
            >
              <Copy size={16} />
            </button>

            {copied && (
              <span className="text-green-400 ml-2 select-none text-xs">Copied!</span>
            )}

            <a
              href={explorerLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline ml-4 text-xs"
            >
              View on Explorer
            </a>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm text-gray-300 mb-6">
            <div>
              <span className="font-semibold text-white">Creator</span>
              <p className="font-mono">
                {token.creator_wallet.slice(0, 6)}...{token.creator_wallet.slice(-4)}
              </p>
            </div>
            <div>
              <span className="font-semibold text-white">Status</span>
              <p className={isGraduated ? 'text-green-400 font-semibold' : 'text-yellow-400 font-semibold'}>
                {isGraduated ? 'Graduated' : 'In Progress'}
              </p>
            </div>
            <div>
              <span className="font-semibold text-white">Raised</span>
              <p>{Number(raised).toFixed(6).replace(/\.?0+$/, '')} / {cap} ETH</p>
            </div>
            <div>
              <span className="font-semibold text-white">Current Price</span>
              <p>{token.onChainData?.currentPrice?.toFixed(7) ?? '–'} ETH</p>
            </div>
            <div>
              <span className="font-semibold text-white">Max Supply</span>
              <p>{token.supply.toLocaleString()}</p>
            </div>
            <div>
              <span className="font-semibold text-white">Locked by Creator</span>
              <p>{token.lockedAmount ? parseFloat(token.lockedAmount).toFixed(0) : '0'}</p>
            </div>
            <div>
              <span className="font-semibold text-white">FDV</span>
              <p>
                {token.onChainData?.currentPrice
                  ? `${(token.supply * token.onChainData.currentPrice).toFixed(6).replace(/\.?0+$/, '')} ETH`
                  : '–'}
              </p>
            </div>
            {token.onChainData?.currentPrice !== undefined &&
              token.onChainData?.totalSupply !== undefined && (
                <div>
                  <span className="font-semibold text-white">Market Cap</span>
                  <p className="text-sm text-white">
                    {(
                      (Number(token.onChainData.totalSupply) / 1e18 - Number(token.onChainData.creatorLockAmount)) *
                      token.onChainData.currentPrice
                    ).toFixed(6).replace(/\.?0+$/, '')} ETH
                  </p>
                </div>
              )}
          </div>

          {/* Creator Actions */}
          {isCreator && (
            <div className="inline-flex flex-col items-stretch space-y-4">
              {!isGraduated && <CreatorBuySection token={token} onSuccess={onRefresh} />}
              {token.onChainData?.airdropFinalized && <AirdropForm token={token} />}
              {canGraduate && (
                <button
                  onClick={handleGraduate}
                  disabled={isGraduating}
                  className={`w-full px-5 py-2.5 rounded-md font-semibold text-white text-sm transition ${
                    isGraduating
                      ? 'bg-neutral-700 cursor-not-allowed'
                      : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:brightness-110'
                  }`}
                >
                  {isGraduating ? 'Graduating...' : '🚀 Graduate Token'}
                </button>
              )}
              {isGraduated && Number(token.lockedAmount ?? 0) > 0 && (
                <button
                  onClick={handleUnlock}
                  disabled={isUnlocking}
                  className={`w-full px-5 py-2.5 rounded-md font-semibold text-white text-sm transition ${
                    isUnlocking
                      ? 'bg-neutral-700 cursor-not-allowed'
                      : 'bg-gradient-to-r from-green-600 to-blue-600 hover:brightness-110'
                  }`}
                >
                  {isUnlocking ? 'Unlocking...' : '🔓 Unlock Creator Tokens'}
                </button>
              )}
              {isGraduated && Number(raised) > 0 && (
                <WithdrawForm contractAddress={token.contract_address} onSuccess={onRefresh} />
              )}
            </div>
          )}

          {!isCreator && !isGraduated && (
            <div className="mt-6">
              <PublicBuySection token={token} onSuccess={onRefresh} />
            </div>
          )}

          {!isCreator && isGraduated && <AirdropClaimForm token={token} />}
        </div>
      </div>
    </div>
  )
}







