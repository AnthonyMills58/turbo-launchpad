'use client'
import { ethers } from 'ethers'
import { Token } from '@/types/token'
import { useAccount, useChainId, usePublicClient, useWriteContract } from 'wagmi'
import { useState, useEffect, useMemo, useRef } from 'react'
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
import { formatLargeNumber } from '@/lib/displayFormats'
import { checkIfTokenOnDex } from '@/lib/checkDexListing'
import LogoContainer from './LogoContainer'
import ExternalImageContainer from './ExternalImageContainer'
import UserProfile from './UserProfile'
import { formatPriceMetaMask } from '@/lib/ui-utils'

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
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const chainId = useChainId()
  const { writeContractAsync } = useWriteContract()
  const { triggerSync } = useSync()

  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isUnlocking, setIsUnlocking] = useState(false)

  // Track if we've already synced this token to prevent infinite loops
  const syncedTokens = useRef(new Set<number>())
  // Track ongoing sync operations to prevent race conditions
  const syncingTokens = useRef(new Set<number>())
  // Track last sync time to add debouncing
  const lastSyncTime = useRef<number>(0)
  // Track if component is still mounted
  const isMounted = useRef(true)

  const isCreator =
    !!address && address.toLowerCase() === token.creator_wallet.toLowerCase()
  const contract_address = token.contract_address

  const chainMap = {
    [megaethTestnet.id]: megaethTestnet,
    [megaethMainnet.id]: megaethMainnet,
    [sepoliaTestnet.id]: sepoliaTestnet,
  } as const

  const chain = chainMap[chainId as keyof typeof chainMap]
  const explorerBaseUrl = chain?.blockExplorers?.default.url ?? ''
  const explorerLink = `${explorerBaseUrl}/address/${token.contract_address}`

  // unified graduation flag
  const graduated = token.on_dex || token.is_graduated

  // compute unlock time and canUnlock
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
    !token.creator_locking_closed &&
    lifetimeLeft > 0

  // Detect whether airdrops exist (array or map supported)
  type AirdropAllocations =
    | string[]
    | Record<string, string | number>
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

  const [userTokenBalance, setUserTokenBalance] = useState<number | null>(null)

  useEffect(() => {
    const fetchTokenBalance = async () => {
      try {
        if (!window.ethereum || !token?.contract_address) return
        const provider = new ethers.BrowserProvider(window.ethereum)
        const signer = await provider.getSigner()
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

    const nowTs = Date.now()
    if (nowTs - lastSyncTime.current < 2000) {
      return
    }
    if (syncedTokens.current.has(token.id)) return
    if (syncingTokens.current.has(token.id)) return

    const checkAndSyncDex = async () => {
      try {
        syncingTokens.current.add(token.id)
        lastSyncTime.current = Date.now()

        const isOnDex = await checkIfTokenOnDex(contract_address, chainId)

        if (isOnDex) {
          const response = await fetch('/api/sync-dex-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, chainId }),
          })

          if (response.ok) {
            syncedTokens.current.add(token.id)
            if (isMounted.current) onRefresh()
          } else {
            console.error('Failed to sync DEX state:', await response.text())
          }
        } else {
          syncedTokens.current.add(token.id)
        }
      } catch (error) {
        console.error('Error in checkAndSyncDex:', error)
      } finally {
        syncingTokens.current.delete(token.id)
      }
    }

    checkAndSyncDex()
  }, [contract_address, chainId, onRefresh, token])

  useEffect(() => {
    return () => {
      isMounted.current = false
    }
  }, [])

  // ===== Helpers to mirror card formatting =====
  const getNumericPrice = (): number => {
    if (token.current_price !== undefined && token.current_price !== null) {
      return Number(token.current_price)
    }
    return 0
  }

  const getFDV = (): number | null => {
    if (token.on_dex && token.fdv !== undefined) {
      return Number(token.fdv)
    } else if (!token.on_dex) {
      return Number(token.eth_raised) || 0
    }
    return null
  }

  const getFDVLabel = (): string => {
    return token.on_dex ? 'FDV' : 'Cap'
  }

  const formatUSDValue = (ethValue: number, usdPriceLocal: number | null) => {
    if (!usdPriceLocal || ethValue === 0 || ethValue === null) return '—'
    const usdValue = ethValue * usdPriceLocal

    if (usdValue < 0.001) {
      const usdInfo = formatPriceMetaMask(usdValue)
      if (usdInfo.type === 'metamask') {
        return (
          <span>
            ${usdInfo.value}
            <sub className="text-xs font-normal" style={{ fontSize: '0.72em' }}>
              {usdInfo.zeros}
            </sub>
            {usdInfo.digits}
          </span>
        )
      }
      return `$${usdInfo.value}`
    }

    if (usdValue >= 1000) {
      return `$${formatLargeNumber(usdValue)}`
    }

    if (usdValue >= 0.1) {
      return `$${usdValue.toFixed(2)}`
    } else if (usdValue >= 0.01) {
      return `$${usdValue.toFixed(3)}`
    } else {
      return `$${usdValue.toFixed(4)}`
    }
  }

  const formatRelativeTime = (dateString: string): string => {
    const nowDate = new Date()
    const created = new Date(dateString)
    const diffMs = nowDate.getTime() - created.getTime()

    const diffSeconds = Math.floor(diffMs / 1000)
    const diffMinutes = Math.floor(diffSeconds / 60)
    const diffHours = Math.floor(diffMinutes / 60)
    const diffDays = Math.floor(diffHours / 24)
    const diffMonths = Math.floor(diffDays / 30)
    const diffYears = Math.floor(diffDays / 365)

    if (diffYears > 0) return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`
    if (diffMonths > 0) return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`
    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
    if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
    if (diffMinutes > 0) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`
    return 'Just now'
  }

  const createdTime = token.created_at ? formatRelativeTime(token.created_at) : '—'

  // ========= JSX =========
  try {

    
    return (
      <div className="w-full p-0 bg-transparent text-white">
        {/* ======= Responsive layout: Stats (left, flex-1) + Actions (right, fixed) ======= */}
        <div className="flex flex-col lg:flex-row items-start gap-0">
          {/* ================= LEFT: STATS CARD ================= */}
          <div className="group rounded-xl p-3 border bg-transparent border-gray-600 flex-1 relative">
            {/* Social media icons - responsive positioning */}
            <div className="absolute top-3 right-3 hidden lg:flex items-center gap-1 text-blue-400">
              {token.website && (
                <a
                  href={/^https?:\/\//i.test(token.website) ? token.website : `https://${token.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center hover:text-blue-300 text-lg"
                  title="Website"
                  onClick={(e) => e.stopPropagation()}
                >
                  🌐
                </a>
              )}
              {token.twitter && (
                <a
                  href={/^https?:\/\//i.test(token.twitter) ? token.twitter : `https://${token.twitter}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center hover:text-blue-300 text-lg"
                  title="Social"
                  onClick={(e) => e.stopPropagation()}
                >
                  🐦
                </a>
              )}
              {token.telegram && (
                <a
                  href={/^https?:\/\//i.test(token.telegram) ? token.telegram : `https://${token.telegram}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center hover:text-blue-300 text-lg"
                  title="Community"
                  onClick={(e) => e.stopPropagation()}
                >
                  💬
                </a>
              )}
            </div>

            {/* Header row: Avatar | token + creator | token-info (moves below on narrow) | progress below */}
            <div className="mb-4">
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div className="flex-shrink-0">
                  {token.token_logo_asset_id ? (
                    <LogoContainer
                      src={`/api/media/${token.token_logo_asset_id}?v=thumb`}
                      alt={token.name}
                      baseWidth={202}
                      className="rounded-lg"
                      draggable={false}
                      onError={() => {}}
                    />
                  ) : token.image ? (
                    <ExternalImageContainer
                      src={token.image}
                      alt={token.name}
                      baseWidth={202}
                      className="rounded-lg"
                      draggable={false}
                    />
                  ) : (
                    <div className="w-[202px] h-[202px] bg-gradient-to-br from-purple-500 to-indigo-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">
                      {token.symbol[0]}
                    </div>
                  )}
                </div>

                {/* Right side: token + creator + tokeninfo layout */}
                <div className="flex flex-col w-full">
                  {/* Row that can wrap: token + creator + tokeninfo */}
                  <div className="flex items-start gap-4 flex-wrap">
                    {/* Token section */}
                    <div className="flex flex-col items-start text-left" title={token.name}>
                      <h3 className="font-semibold text-white truncate w-full">{token.symbol}</h3>

                      {/* Contract + copy */}
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span className="font-mono">
                          {token.contract_address.slice(0, 6)}...{token.contract_address.slice(-4)}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCopy()
                          }}
                          className="text-gray-400 hover:text-white transition"
                          title="Copy contract address"
                        >
                          <Copy size={12} />
                        </button>
                        {copied && <span className="text-green-400 text-xs">Copied!</span>}
                      </div>

                      {/* On DEX + Explorer links */}
                      {token.on_dex && token.dex_listing_url && (
                        <a
                          href={token.dex_listing_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors mt-1"
                          title="View on DEX"
                          onClick={(e) => e.stopPropagation()}
                        >
                          On DEX ↗
                        </a>
                      )}
                      <a
                        href={explorerLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors mt-1"
                        title="View on Explorer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        On Explorer ↗
                      </a>
                    </div>

                    {/* Creator section */}
                    <div className="flex justify-start items-start">
                      <UserProfile
                        wallet={token.creator_wallet}
                        showAvatar={false}
                        showName={true}
                        showCreatorLabel={false}
                        showTime={true}
                        createdTime={createdTime}
                        layout="compact"
                        centerAlign={false}
                      />
                    </div>

                    {/* Token info (name + moved links) — full width below on small */}
                    <div className="flex flex-col items-start text-left max-w-xl min-w-0 w-full basis-full lg:w-auto lg:basis-auto">
                      <div className="text-sm flex items-start gap-2 min-w-0">
                        <span className="text-gray-400">Token name:</span>
                        <span className="text-white font-medium truncate">{token.name || '—'}</span>
                        
                        {/* Social media icons for mobile - visible on small screens only */}
                        <span className="flex items-center gap-1 ml-2 text-blue-400 lg:hidden">
                          {token.website && (
                            <a
                              href={/^https?:\/\//i.test(token.website) ? token.website : `https://${token.website}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center hover:text-blue-300 text-lg"
                              title="Website"
                              onClick={(e) => e.stopPropagation()}
                            >
                              🌐
                            </a>
                          )}
                          {token.twitter && (
                            <a
                              href={/^https?:\/\//i.test(token.twitter) ? token.twitter : `https://${token.twitter}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center hover:text-blue-300 text-lg"
                              title="Social"
                              onClick={(e) => e.stopPropagation()}
                            >
                              🐦
                            </a>
                          )}
                          {token.telegram && (
                            <a
                              href={/^https?:\/\//i.test(token.telegram) ? token.telegram : `https://${token.telegram}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center hover:text-blue-300 text-lg"
                              title="Community"
                              onClick={(e) => e.stopPropagation()}
                            >
                              💬
                            </a>
                          )}
                        </span>
                      </div>

                      {token.description && (
                        <p
                          className="mt-1 text-sm text-gray-300 w-full break-words overflow-hidden"
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflowWrap: 'anywhere',
                            wordBreak: 'break-word',
                            fontSize: '0.7em',
                          }}
                          title={token.description}
                        >
                          {token.description.split(' ').map(word => 
                            word.length > 30 
                              ? word.match(/.{1,30}/g)?.join(' ') || word
                              : word
                          ).join(' ')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Progress bar spanning below token + creator + tokeninfo */}
                  {!token.on_dex && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-white">Graduation Progress</span>
                        <span className="text-sm font-semibold text-orange-400">
                          {token.raise_target && token.eth_raised
                            ? `${Math.min(
                                Math.floor(
                                  (Number(token.eth_raised) / Number(token.raise_target)) * 100
                                ),
                                100
                              )}%`
                            : '0%'}
                        </span>
                      </div>
                      <div className="relative h-4 rounded-full overflow-hidden border border-[#2a2d3a]">
                        <div
                          className="absolute inset-0"
                          style={{
                            backgroundImage: `repeating-linear-gradient(
                              -45deg,
                              rgba(100,100,100,0.25) 0px,
                              rgba(100,100,100,0.25) 12px,
                              rgba(255,255,255,0.15) 12px,
                              rgba(255,255,255,0.15) 20px
                            )`,
                            backgroundSize: '20px 20px',
                            animation: 'moveStripes 1.28s linear infinite',
                          }}
                        />
                        <div
                          className="relative h-full rounded-full transition-all duration-500 ease-out overflow-hidden"
                          style={{
                            width:
                              token.raise_target && token.eth_raised
                                ? `${Math.min(
                                    (Number(token.eth_raised) / Number(token.raise_target)) * 100,
                                    100
                                  )}%`
                                : '0%',
                          }}
                        >
                          <div className="absolute inset-0 bg-gradient-to-r from-purple-500 via-blue-500 to-cyan-400 opacity-90" />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Stats section directly below progress bar */}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {/* Price */}
                    <div className="rounded-lg border border-[#2a2d3a] px-3 py-2 min-w-[140px] flex-1 sm:flex-none">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">Price</span>
                        <span className="text-sm font-semibold text-white">
                          {token.current_price !== undefined && token.current_price !== null && usdPrice
                            ? formatUSDValue(getNumericPrice(), usdPrice)
                            : '—'}
                        </span>
                      </div>
                    </div>

                    {/* FDV / Cap */}
                    <div className="rounded-lg border border-[#2a2d3a] px-3 py-2 min-w-[140px] flex-1 sm:flex-none">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">{getFDVLabel()}</span>
                        <span className="text-sm font-semibold text-white">
                          {usdPrice && getFDV() !== null ? formatUSDValue(getFDV()!, usdPrice) : '—'}
                        </span>
                      </div>
                    </div>

                    {/* Holders */}
                    <div className="rounded-lg border border-[#2a2d3a] px-3 py-2 min-w-[140px] flex-1 sm:flex-none">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">Holders</span>
                        <span className="text-sm font-semibold text-white">
                          {token.holders_count !== undefined && token.holders_count !== null
                            ? formatLargeNumber(token.holders_count)
                            : '—'}
                        </span>
                      </div>
                    </div>

                    {/* Volume 24h (only if on DEX) */}
                    {token.on_dex && (
                      <div className="rounded-lg border border-[#2a2d3a] px-3 py-2 min-w-[140px] flex-1 sm:flex-none">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-400">Vol <sub className="text-[10px]">24h</sub></span>
                          <span className="text-sm font-semibold text-white">
                            {token.volume_24h_eth !== undefined &&
                            token.volume_24h_eth !== null &&
                            token.volume_24h_eth > 0 &&
                            usdPrice
                              ? formatUSDValue(token.volume_24h_eth, usdPrice)
                              : '—'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Liquidity (only if on DEX) */}
                    {token.on_dex && (
                      <div className="rounded-lg border border-[#2a2d3a] px-3 py-2 min-w-[140px] flex-1 sm:flex-none">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-400">Liquidity</span>
                          <span className="text-sm font-semibold text-white">
                            {token.liquidity_eth !== undefined &&
                            token.liquidity_eth !== null &&
                            token.liquidity_eth > 0 &&
                            usdPrice
                              ? formatUSDValue(token.liquidity_eth, usdPrice)
                              : '—'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Supply */}
                    <div className="rounded-lg border border-[#2a2d3a] px-3 py-2 min-w-[140px] flex-1 sm:flex-none">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">Supply</span>
                        <span className="text-sm font-semibold text-white">
                          {token.total_supply !== undefined && token.total_supply !== null
                            ? formatLargeNumber(Number(token.total_supply) / 1e18)
                            : '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>


            {/* ===== Edit Token Info — inline inside stats (creator only) ===== */}
            {isCreator && (
              <div className="mt-2">
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="w-full px-5 py-2 rounded-md font-semibold text-white text-sm transition bg-transparent border border-gray-600 hover:border-gray-500"
                >
                  {isEditing ? 'Cancel Edit' : '✏️ Edit Token Info'}
                </button>

                {isEditing && (
                  <div className="mt-3 border border-[#2a2d3a] rounded-lg p-3 bg-transparent">
                    <EditTokenForm
                      token={token}
                      onSuccess={() => {
                        setIsEditing(false)
                        onRefresh()
                      }}
                      onCancel={() => setIsEditing(false)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ================= RIGHT: ACTIONS WRAPPER (stacked, no extra cards) ================= */}
          <div className="w-full max-w-sm space-y-4 border border-gray-600 rounded-xl p-3 bg-transparent">
            {/* CREATOR / PUBLIC ACTIONS */}
            {isCreator ? (
              <>
                {canUnlock && (
                  <div>
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
                  </div>
                )}

                {!graduated && canCreatorBuyLock && (
                  <CreatorBuySection token={token} onSuccess={onRefresh} />
                )}

                {!graduated && <AirdropForm token={token} onSuccess={onRefresh} />}

                {!graduated && userTokenBalance !== null && userTokenBalance > 0 && (
                  <PublicSellSection token={token} onSuccess={onRefresh} />
                )}

                {graduated && hasAirdrops && <AirdropForm token={token} onSuccess={onRefresh} />}
              </>
            ) : (
              <>
                {!graduated && (
                  <>
                    <PublicBuySection token={token} onSuccess={onRefresh} />
                    {userTokenBalance !== null && userTokenBalance > 0 && (
                      <PublicSellSection token={token} onSuccess={onRefresh} />
                    )}
                  </>
                )}
                {graduated && <AirdropClaimForm token={token} />}
              </>
            )}
          </div>
          {/* ================= /RIGHT: ACTIONS ================= */}
        </div>
      </div>
    )



  } catch (error) {
    console.error('TokenDetailsView render error:', error)
    return (
      <div className="max-w-4xl mx-auto mt-0 p-6 bg-transparent rounded-lg shadow-lg text-white">
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













