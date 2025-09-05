'use client'
import { ethers } from 'ethers'
import { Token } from '@/types/token'
import { useAccount, useChainId, usePublicClient, useWriteContract } from 'wagmi'
import { useState, useEffect, useMemo } from 'react'
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
import { formatLargeNumber } from '@/lib/displayFormats'
import { syncDexState } from '@/lib/syncDexState'
import LogoContainer from './LogoContainer'
import ExternalImageContainer from './ExternalImageContainer'
import UserProfile from './UserProfile'

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
  // Debug logging removed - issue fixed
  
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const chainId = useChainId()
  const { writeContractAsync } = useWriteContract()
  const { triggerSync } = useSync()

  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [copiedCreator, setCopiedCreator] = useState(false)

  const isCreator =
    !!address && address.toLowerCase() === token.creator_wallet.toLowerCase()
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

  // ======== NEW: unified graduation flag ========
  const graduated = token.on_dex || isGraduated

  // ======== NEW: compute unlock time and canUnlock ========
  const unlockTime: number | null = useMemo(() => {
    if (token.creator_unlock_time && token.creator_unlock_time > 0) {
      return token.creator_unlock_time
    }
    if (token.created_at && token.min_token_age_for_unlock_seconds) {
      const created = Math.floor(new Date(token.created_at).getTime() / 1000)
      return created + token.min_token_age_for_unlock_seconds
    }
    return null
  }, [token])

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])

  const hasLocked = Number(token.creator_lock_amount ?? 0) > 0
  const cooldownReached = unlockTime !== null && now >= unlockTime
  const canUnlock = isCreator && hasLocked && (graduated || cooldownReached)

  const maxCreatorLock = 0.2 * Number(token.supply || 0)
  const lifetimeUsed = Number(token.creator_lock_cumulative ?? 0)
  const lifetimeLeft = Math.max(0, maxCreatorLock - lifetimeUsed)

  const canCreatorBuyLock =
    isCreator &&
    !graduated &&
    !token.creator_locking_closed && // 🔒 respect contract flag
    lifetimeLeft > 0
  // ========================================================

  // Detect whether airdrops exist (array or map supported)
  type AirdropAllocations =
    | string[] // array of addresses
    | Record<string, string | number> // map of address -> amount

  const allocations = token.airdrop_allocations as AirdropAllocations | undefined

  const hasAirdrops =
    (Array.isArray(allocations) && allocations.length > 0) ||
    (!!allocations &&
      !Array.isArray(allocations) &&
      Object.keys(allocations).length > 0)

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
      onRefresh?.()
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
        const contract = new ethers.Contract(
          token.contract_address,
          TurboTokenABI.abi,
          signer
        )
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

  // Add error boundary for production debugging
  try {
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
          {token.token_logo_asset_id ? (
            <>
              <LogoContainer
                     src={`/api/media/${token.token_logo_asset_id}?v=thumb`}
                     alt={token.name}
                     baseWidth={128}
                     className="rounded-xl"
                     draggable={false}
                     onError={() => {
                       // Fallback to placeholder if media fails to load
                       // The LogoContainer will handle the error internally
                     }}
                   />
            </>
          ) : token.image ? (
            <>
              <ExternalImageContainer
                src={token.image}
                alt={token.name}
                baseWidth={128}
                className="rounded-xl"
                draggable={false}
              />
            </>
          ) : null}
          
          {/* Fallback placeholder */}
                                               <div className={`w-32 h-20 bg-gray-700 rounded-xl flex items-center justify-center text-2xl font-bold ${token.token_logo_asset_id || token.image ? 'hidden' : ''}`}>
               {token.symbol[0]}
             </div>
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
            <div className="flex items-center gap-2">
              <UserProfile wallet={token.creator_wallet} showAvatar={true} showName={true} showCreatorLabel={true} />
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
                  {formatLargeNumber(Number(raised || 0))} / {formatLargeNumber(cap || 0)} ETH
                </p>
              </div>
            </div>

            <div>
              <span className="font-semibold text-white">Current Price</span>
              <div className="text-sm text-white">
                <p>
                  {token.current_price !== undefined && token.current_price !== null
                    ? `${formatLargeNumber(Number(token.current_price))} ETH`
                    : '–'}
                </p>
                {usdPrice && token.current_price !== undefined && token.current_price !== null && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    (${formatLargeNumber(Number(token.current_price) * usdPrice)})
                  </p>
                )}
              </div>
            </div>

            <div>
              <span className="font-semibold text-white">Max Supply</span>
              <p>{Number(token.supply || 0).toLocaleString()}</p>
            </div>

            <div>
              <span className="font-semibold text-white">Locked by Creator</span>
              <p>
                {token.creator_lock_amount
                  ? Number(token.creator_lock_amount).toLocaleString()
                  : '0'}
              </p>
              {/* (Optional) show ETA pre-grad */}
              {!graduated && unlockTime && (
                <p className="text-xs text-gray-500">
                  Early unlock {cooldownReached ? 'available now' : 'at'}{' '}
                  {new Date(unlockTime * 1000).toLocaleString()}
                </p>
              )}
            </div>

            <div>
              <span className="font-semibold text-white">FDV</span>
              <p>
                {token.fdv !== undefined && token.fdv !== null
                  ? `${formatLargeNumber(Number(token.fdv))} ETH`
                  : '–'}
              </p>
            </div>

            {token.on_dex && token.market_cap !== undefined && token.market_cap !== null && (
              <div>
                <span className="font-semibold text-white">Market Cap</span>
                <p className="text-sm text-white">
                  {formatLargeNumber(Number(token.market_cap))} ETH
                  {usdPrice && (
                    <span className="text-gray-400">
                      {' '}
                      (${formatLargeNumber(token.market_cap * usdPrice)})
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

          {/* ====== CREATOR ACTIONS ====== */}
          {isCreator && (
            <div className="flex flex-col space-y-4">
              {/* Show Unlock when allowed (pre- or post-graduation) */}
              {canUnlock && (
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

              {/* Buy & Airdrop before graduation */}
              {!graduated && (
                <div className="flex flex-col md:flex-row md:items-start gap-4">
                  {canCreatorBuyLock ? (
                   <CreatorBuySection token={token} onSuccess={onRefresh} />
                 ) : (
                   <div className="w-full md:w-7/16 text-xs text-gray-400 border border-gray-700 rounded-md p-3">
                     <div className="font-semibold text-white mb-1">Creator Buy &amp; Lock unavailable</div>
                     {token.creator_locking_closed ? (
                      <span>Locking is closed by the contract</span>
                     ) : (
                       <span>
                         Lifetime 20% cap reached ({lifetimeUsed.toLocaleString()}).
                       </span>                      )}                    </div>
                  )}

                  <AirdropForm token={token} onSuccess={onRefresh} />
                </div>
              )}


              {/* Creator public sell (pre-grad only if they have balance) */}
              {!graduated && userTokenBalance !== null && userTokenBalance > 0 && (
                <div className="w-full md:w-1/2">
                  <PublicSellSection token={token} onSuccess={onRefresh} />
                </div>
              )}

              {/* Post-graduation: keep AirdropForm only if airdrops exist */}
              {graduated && hasAirdrops && (
                <AirdropForm token={token} onSuccess={onRefresh} />
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

          {/* ====== PUBLIC / NON-CREATOR ACTIONS ====== */}
          {!isCreator && (
            <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
              {/* Pre-grad: buy/sell on curve */}
              {!graduated && (
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

              {/* Post-grad: claim airdrops */}
              {graduated && (
                <div className="w-full md:w-1/3">
                  <AirdropClaimForm token={token} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
  } catch (error) {
    console.error('TokenDetailsView render error:', error)
    return (
      <div className="max-w-4xl mx-auto mt-0 p-6 bg-[#1b1e2b] rounded-lg shadow-lg text-white">
        <div className="text-center text-red-400">
          <h2 className="text-xl font-bold mb-4">Error loading token details</h2>
          <p className="text-sm mb-4">Something went wrong while loading this token.</p>
          <button
            onClick={onBack}
            className="text-sm text-gray-400 hover:text-white transition"
          >
            ← Back to all tokens
          </button>
        </div>
      </div>
    )
  }
}










