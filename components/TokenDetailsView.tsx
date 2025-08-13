'use client'
import { ethers } from 'ethers'
import { Token } from '@/types/token'
import { useAccount, useChainId, usePublicClient, useWriteContract } from 'wagmi'
import { useState, useEffect } from 'react'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import CreatorBuySection from './CreatorBuySection'
import PublicBuySection from './PublicBuySection'
import AirdropForm from './AirdropForm'
import AirdropClaimForm from './AirdropClaimForm'
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from '@/lib/chains'
import { Copy } from 'lucide-react'
import EditTokenForm from './EditTokenForm'
import PublicSellSection from './PublicSellSection'
import { useSync } from '@/lib/SyncContext'
import { CircularProgressbar, buildStyles } from 'react-circular-progressbar'
import 'react-circular-progressbar/dist/styles.css'
import { formatValue } from '@/lib/displayFormats'
import { syncDexState } from '@/lib/syncDexState'

type TokenDetailsViewProps = {
  token: Token
  usdPrice: number | null
  onBack: () => void
  onRefresh: () => void
}

export default function TokenDetailsView({
  token,
  usdPrice,
  onBack,
  onRefresh,
}: TokenDetailsViewProps) {
  const { triggerSync } = useSync()
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const chainId = useChainId()
  const { writeContractAsync } = useWriteContract()

  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [copiedCreator, setCopiedCreator] = useState(false)

  const isCreator = address?.toLowerCase() === token.creator_wallet.toLowerCase()
  const isGraduated = token.is_graduated
  const raised = token.eth_raised
  const cap = token.raise_target
  const contract_address = token.contract_address

  const chainMap = {
    [megaethTestnet.id]: megaethTestnet,
    [megaethMainnet.id]: megaethMainnet,
    [sepoliaTestnet.id]: sepoliaTestnet,
  } as const

  const chain = chainMap[chainId as keyof typeof chainMap]
  const explorerBaseUrl = chain?.blockExplorers?.default.url ?? ''
  const explorerLink = `${explorerBaseUrl}/address/${token.contract_address}`

  const handleUnlock = async () => {
    try {
      if (!publicClient) return
      setIsUnlocking(true)

      const txHash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'unlockCreatorTokens',
      })

      await publicClient.waitForTransactionReceipt({ hash: txHash })

      // Full sync into DB
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: token.id,
          contractAddress: token.contract_address,
          chainId,
        }),
      })
      triggerSync()
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

  const handleCopyCreator = () => {
    navigator.clipboard.writeText(token.creator_wallet)
    setCopiedCreator(true)
    setTimeout(() => setCopiedCreator(false), 1500)
  }

  const [userTokenBalance, setUserTokenBalance] = useState<number | null>(null)
  const [userEthBalance, setUserEthBalance] = useState<number | null>(null)
  console.log(userEthBalance)

  useEffect(() => {
    const fetchTokenBalance = async () => {
      try {
        if (!window.ethereum || !token?.contract_address) return
        const provider = new ethers.BrowserProvider(window.ethereum)
        const signer = await provider.getSigner()
        const eth = await provider.getBalance(await signer.getAddress())
        setUserEthBalance(parseFloat(ethers.formatEther(eth)))
        const contract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, signer)
        const tokenBal = await contract.balanceOf(await signer.getAddress())
        setUserTokenBalance(parseFloat(ethers.formatUnits(tokenBal, 18)))
      } catch (err) {
        console.error('Failed to fetch user balances:', err)
      }
    }
    fetchTokenBalance()
  }, [token.contract_address])

  useEffect(() => {
    if (!contract_address || !chainId) return
    syncDexState(token, chainId, onRefresh)
  }, [contract_address, chainId, onRefresh, token])


return (
  <div className="max-w-4xl mx-auto mt-0 p-6 bg-[#1b1e2b] rounded-lg shadow-lg text-white">
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

        {/* Contract Info */}
        <div className="flex items-center flex-wrap mb-4 space-x-2 font-mono text-sm text-gray-400 select-all">
          <span>Contract:</span>
          <span>
            {token.contract_address.slice(0, 6)}...
            {token.contract_address.slice(-4)}
          </span>
          <button
            onClick={handleCopy}
            className="text-gray-400 hover:text-white transition"
          >
            <Copy size={16} />
          </button>
          {copied && (
            <span className="text-green-400 ml-2 text-xs">Copied!</span>
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
          {/* Creator Address */}
          <div className="flex items-center flex-wrap mb-4 space-x-2 font-mono text-sm text-gray-400 select-all">
            <span>Creator:</span>
            <span>
              {token.creator_wallet.slice(0, 6)}...
              {token.creator_wallet.slice(-4)}
            </span>
            <button
              onClick={handleCopyCreator}
              className="text-gray-400 hover:text-white transition"
            >
              <Copy size={16} />
            </button>
            {copiedCreator && (
              <span className="text-green-400 ml-2 text-xs">Copied!</span>
            )}
          </div>

          {token.created_at && (
            <div className="text-sm text-gray-400 mb-1">
              Created:
              <div className="text-white">
                {new Date(token.created_at).toLocaleDateString()}
              </div>
            </div>
          )}

          <div>
            <span className="font-semibold text-white">Status</span>
            <p
              className={`font-semibold ${
                token.on_dex
                  ? 'text-blue-400'
                  : isGraduated
                  ? 'text-green-400'
                  : 'text-yellow-400'
              }`}
            >
              {token.on_dex
                ? `Listed on ${token.dex ?? 'DEX'}`
                : isGraduated
                ? 'Graduated'
                : 'In Progress'}
            </p>
          </div>

          <div className="flex items-center gap-4 mt-0">
            <div className="w-14 h-14">
              <CircularProgressbar
                value={
                  Number(cap) > 0
                    ? Math.min((Number(raised) / Number(cap)) * 100, 999)
                    : 0
                }
                text={
                  Number(cap) === 0 || Number(raised) === 0
                    ? '0%'
                    : (Number(raised) / Number(cap)) * 100 < 1
                      ? '<1%'
                      : `${Math.floor((Number(raised) / Number(cap)) * 100)}%`
                }
                styles={buildStyles({
                  textSize: '1.8rem',
                  textColor: '#ffffff',
                  pathColor: '#10B981',
                  trailColor: '#374151',
                })}
              />
            </div>

            <div>
              <span className="font-semibold text-white">Raised</span>
              <p>
                {formatValue(Number(raised))} / {cap} ETH
              </p>
            </div>
          </div>

          <div>
            <span className="font-semibold text-white">Current Price</span>
            <div className="text-sm text-white">
              <p>
                {token.current_price !== undefined
                  ? `${formatValue(Number(token.current_price))} ETH`
                  : '–'}
              </p>
              {usdPrice && token.current_price !== undefined && (
                <p className="text-xs text-gray-400 mt-0.5">
                  (${formatValue(Number(token.current_price) * usdPrice)})
                </p>
              )}
            </div>
          </div>

          <div>
            <span className="font-semibold text-white">Max Supply</span>
            <p>{Number(token.supply).toLocaleString()}</p>
          </div>

          <div>
            <span className="font-semibold text-white">Locked by Creator</span>
            <p>
              {token.creator_lock_amount
                ? Number(token.creator_lock_amount).toLocaleString()
                : '0'}
            </p>
          </div>

          <div>
            <span className="font-semibold text-white">FDV</span>
            <p>
              {token.fdv !== undefined
                ? `${formatValue(Number(token.fdv))} ETH`
                : '–'}
            </p>
          </div>

          {token.on_dex && token.market_cap !== undefined && (
            <div>
              <span className="font-semibold text-white">Market Cap</span>
              <p className="text-sm text-white">
                {formatValue(Number(token.market_cap))} ETH
                {usdPrice && (
                  <span className="text-gray-400">
                    {' '}
                    (${(token.market_cap * usdPrice).toFixed(2)})
                  </span>
                )}
              </p>
            </div>
          )}
        </div>

        {/* If token is already deployed, optionally show a link */}
        {token.on_dex && token.dex_listing_url && (
          <div className="mt-6">
            <h2 className="text-white font-semibold text-lg mb-2">
              ✅ Token is Deployed to DEX
            </h2>
            <a
              href={token.dex_listing_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline text-sm"
            >
              View Listing on DEX ↗
            </a>
          </div>
        )}

        {isCreator && !token.on_dex && (
          <div className="flex flex-col space-y-4">
            {/* Buy & Airdrop in one row on desktop */}
            {!isGraduated && (
              <div className="flex flex-col md:flex-row md:items-start gap-4">
                <CreatorBuySection token={token} onSuccess={onRefresh} />
                <AirdropForm token={token} onSuccess={onRefresh} />
              </div>
            )}

            {/* 🔓 Unlock Button (post-graduation) */}
            {isGraduated && Number(token.creator_lock_amount ?? 0) > 0 && (
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

            {/* ✏️ Edit Token Info */}
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="w-full px-5 py-2.5 rounded-md font-semibold text-white text-sm transition bg-gray-800 hover:bg-gray-700"
            >
              {isEditing ? 'Cancel Edit' : '✏️ Edit Token Info'}
            </button>

            {isEditing && (
              <EditTokenForm
                token={token}
                onSuccess={() => {
                  setIsEditing(false)
                  onRefresh()
                }}
                onCancel={() => setIsEditing(false)}
              />
            )}
          </div>
        )}

        {!isCreator && !token.on_dex && (
          <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
            {!isGraduated && (
              <>
                <div className="w-full md:w-3/4">
                  <PublicBuySection token={token} onSuccess={onRefresh} />
                </div>

                {userTokenBalance !== null && userTokenBalance > 0 && (
                  <div className="w-full md:w-1/2">
                    <PublicSellSection token={token} onSuccess={onRefresh} />
                  </div>
                )}
              </>
            )}
            <div className="w-full md:w-1/3">
              <AirdropClaimForm token={token} />
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
)

}








