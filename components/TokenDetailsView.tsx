'use client';
import { ethers } from 'ethers';
import { Token } from '@/types/token';
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWriteContract,
} from 'wagmi';
import { useState, useEffect, useMemo, useRef } from 'react';
import TurboTokenABI from '@/lib/abi/TurboToken.json';
import CreatorBuySection from './CreatorBuySection';
import PublicBuySection from './PublicBuySection';
import AirdropForm from './AirdropForm';
import AirdropClaimForm from './AirdropClaimForm';
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from '@/lib/chains';
import {
  Copy,
  Check,
  ExternalLink,
  Globe,
  Twitter,
  MessageCircle,
} from 'lucide-react';
import EditTokenForm from './EditTokenForm'
import ChartForm from './ChartForm';
import PublicSellSection from './PublicSellSection';
import TransactionTable from './TransactionTable';
import HoldersTable from './HoldersTable';
import { useSync } from '@/lib/SyncContext';
import { formatLargeNumber } from '@/lib/displayFormats';
import { checkIfTokenOnDex } from '@/lib/checkDexListing';
import LogoContainer from './LogoContainer';
import ExternalImageContainer from './ExternalImageContainer';
import UserProfile from './UserProfile';
import { formatPriceMetaMask } from '@/lib/ui-utils';

type TokenDetailsViewProps = {
  token: Token;
  usdPrice: number | null;
  onBack: () => void;
  onRefresh: () => void;
};

export default function TokenDetailsView({
  token,
  usdPrice,
  onBack,
  onRefresh,
}: TokenDetailsViewProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();
  const { triggerSync } = useSync();

  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [showTransactions, setShowTransactions] = useState(true);
  const [showHolders, setShowHolders] = useState(false);
  const [showChart, setShowChart] = useState(true);
  const [activeBuySellTab, setActiveBuySellTab] = useState<'buy' | 'sell'>('buy');
  
  // Track if we've already synced this token to prevent infinite loops
  const syncedTokens = useRef(new Set<number>());
  // Track ongoing sync operations to prevent race conditions
  const syncingTokens = useRef(new Set<number>());
  // Track last sync time to add debouncing
  const lastSyncTime = useRef<number>(0);
  // Track if component is still mounted
  const isMounted = useRef(true);

  const isCreator =
    !!address && address.toLowerCase() === token.creator_wallet.toLowerCase();
  const contract_address = token.contract_address;

  const chainMap = {
    [megaethTestnet.id]: megaethTestnet,
    [megaethMainnet.id]: megaethMainnet,
    [sepoliaTestnet.id]: sepoliaTestnet,
  } as const;

  const chain = chainMap[chainId as keyof typeof chainMap];
  const explorerBaseUrl = chain?.blockExplorers?.default.url ?? '';
  const explorerLink = `${explorerBaseUrl}/address/${token.contract_address}`;

  // unified graduation flag
  const graduated = token.on_dex || token.is_graduated;

  // compute unlock time and canUnlock
  const unlockTime: number | null = useMemo(() => {
    if (token.creator_unlock_time && token.creator_unlock_time > 0) {
      return token.creator_unlock_time;
    }
    if (token.created_at && token.min_token_age_for_unlock_seconds) {
      const created = Math.floor(new Date(token.created_at).getTime() / 1000);
      return created + token.min_token_age_for_unlock_seconds;
    }
    return null;
  }, [token]);

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const hasLocked = Number(token.creator_lock_amount ?? 0) > 0;
  const cooldownReached = unlockTime !== null && now >= unlockTime;
  const canUnlock = isCreator && hasLocked && (graduated || cooldownReached);

  const maxCreatorLock = 0.2 * Number(token.supply || 0);
  const lifetimeUsed = Number(token.creator_lock_cumulative ?? 0);
  const lifetimeLeft = Math.max(0, maxCreatorLock - lifetimeUsed);
  

  const canCreatorBuyLock =
    isCreator &&
    !graduated &&
    !token.creator_locking_closed &&
    lifetimeLeft > 0;

  // Detect whether airdrops exist (array or map supported)
  type AirdropAllocations = string[] | Record<string, string | number>;
  const allocations = token.airdrop_allocations as
    | AirdropAllocations
    | undefined;
  const hasAirdrops =
    (Array.isArray(allocations) && allocations.length > 0) ||
    (!!allocations &&
      !Array.isArray(allocations) &&
      Object.keys(allocations).length > 0);

  const handleUnlock = async () => {
    try {
      if (!publicClient) return;
      setIsUnlocking(true);

      const txHash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'unlockCreatorTokens',
      });

      await publicClient.waitForTransactionReceipt({ hash: txHash });

      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: token.id,
          contractAddress: token.contract_address,
          chainId,
        }),
      });
      triggerSync();
      onRefresh?.();
    } catch (err) {
      console.error('❌ Unlock failed:', err);
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(token.contract_address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const [userTokenBalance, setUserTokenBalance] = useState<number | null>(null);

  useEffect(() => {
    const fetchTokenBalance = async () => {
      try {
        if (!window.ethereum || !token?.contract_address) return;
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const contract = new ethers.Contract(
          token.contract_address,
          TurboTokenABI.abi,
          signer
        );
        const tokenBal = await contract.balanceOf(await signer.getAddress());
        setUserTokenBalance(parseFloat(ethers.formatUnits(tokenBal, 18)));
      } catch (err) {
        console.error('Failed to fetch user balances:', err);
      }
    };
    fetchTokenBalance();
  }, [token.contract_address]);

  // Set smart default tab based on available sections
  useEffect(() => {
    const hasPublicBuy = !graduated && !isCreator;
    const hasPublicSell = !graduated && userTokenBalance !== null && userTokenBalance > 0;
    const hasCreatorBuyLock = !graduated && canCreatorBuyLock;
    
    if (!hasPublicBuy && !hasCreatorBuyLock && hasPublicSell) {
      setActiveBuySellTab('sell');
    } else if ((hasPublicBuy || hasCreatorBuyLock) && !hasPublicSell) {
      setActiveBuySellTab('buy');
    } else {
      setActiveBuySellTab('buy'); // Default to buy if both available
    }
  }, [graduated, userTokenBalance, canCreatorBuyLock, isCreator]);

  useEffect(() => {
    if (!contract_address || !chainId) return;

    const nowTs = Date.now();
    if (nowTs - lastSyncTime.current < 2000) {
      return;
    }
    if (syncedTokens.current.has(token.id)) return;
    if (syncingTokens.current.has(token.id)) return;

    const checkAndSyncDex = async () => {
      try {
        syncingTokens.current.add(token.id);
        lastSyncTime.current = Date.now();
        
        const isOnDex = await checkIfTokenOnDex(contract_address, chainId);
        
        if (isOnDex) {
          const response = await fetch('/api/sync-dex-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, chainId }),
          });
          
          if (response.ok) {
            syncedTokens.current.add(token.id);
            if (isMounted.current) onRefresh();
          } else {
            console.error('Failed to sync DEX state:', await response.text());
          }
        } else {
          syncedTokens.current.add(token.id);
        }
      } catch (error) {
        console.error('Error in checkAndSyncDex:', error);
      } finally {
        syncingTokens.current.delete(token.id);
      }
    };
    
    checkAndSyncDex();
  }, [contract_address, chainId, onRefresh, token]);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Note: Periodic refresh is now handled by SWR in the parent component

  // ===== Helpers to mirror card formatting =====
  const getNumericPrice = (): number => {
    if (token.current_price !== undefined && token.current_price !== null) {
      return Number(token.current_price);
    }
    return 0;
  };

  const getFDV = (): number | null => {
    if (token.on_dex && token.fdv !== undefined) {
      return Number(token.fdv);
    } else if (!token.on_dex) {
      return Number(token.eth_raised) || 0;
    }
    return null;
  };

  const getFDVLabel = (): string => {
    return token.on_dex ? 'FDV' : 'Cap';
  };

  const formatUSDValue = (ethValue: number, usdPriceLocal: number | null) => {
    if (!usdPriceLocal || ethValue === 0 || ethValue === null) return '—';
    const usdValue = ethValue * usdPriceLocal;

    if (usdValue < 0.001) {
      const usdInfo = formatPriceMetaMask(usdValue);
      if (usdInfo.type === 'metamask') {
        return (
          <span>
            ${usdInfo.value}
            <sub className="text-xs font-normal" style={{ fontSize: '0.72em' }}>
              {usdInfo.zeros}
            </sub>
            {usdInfo.digits}
          </span>
        );
      }
      return `$${usdInfo.value}`;
    }

    if (usdValue >= 1000) {
      return `$${formatLargeNumber(usdValue)}`;
    }

    if (usdValue >= 0.1) {
      return `$${usdValue.toFixed(2)}`;
    } else if (usdValue >= 0.01) {
      return `$${usdValue.toFixed(3)}`;
    } else {
      return `$${usdValue.toFixed(4)}`;
    }
  };

  const formatRelativeTime = (dateString: string): string => {
    const nowDate = new Date();
    const created = new Date(dateString);
    const diffMs = nowDate.getTime() - created.getTime();

    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffYears > 0)
      return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
    if (diffMonths > 0)
      return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    if (diffHours > 0)
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffMinutes > 0)
      return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
    return 'Just now';
  };

  const createdTime = token.created_at
    ? formatRelativeTime(token.created_at)
    : '—';

  // Format ETH value using same logic as TransactionTable (without ETH suffix)
  const formatETHValue = (ethAmount: number): string | React.ReactElement => {
    if (ethAmount < 0.001) {
      const ethInfo = formatPriceMetaMask(ethAmount);
      if (ethInfo.type === 'metamask') {
        return (
          <span>
            {ethInfo.value}
            <sub className="text-xs font-normal" style={{ fontSize: '0.72em' }}>
              {ethInfo.zeros}
            </sub>
            {ethInfo.digits}
          </span>
        );
      }
      return ethInfo.value;
    }

    if (ethAmount >= 1000) {
      return formatLargeNumber(ethAmount);
    }

    if (ethAmount >= 0.1) {
      return ethAmount.toFixed(2);
    } else if (ethAmount >= 0.01) {
      return ethAmount.toFixed(3);
    } else {
      return ethAmount.toFixed(4);
    }
  };

  // Determine which buy/sell sections are available (for JSX)
  const hasPublicBuy = !graduated && !isCreator; // Regular BUY for non-creators
  const hasPublicSell = !graduated && userTokenBalance !== null && userTokenBalance > 0;
  const hasCreatorBuyLock = !graduated && canCreatorBuyLock;

  // ========= JSX =========
  try {
    return (
      <div className="w-full bg-transparent p-0 text-white">
        {/* ======= Responsive layout: Stats (left, flex-1) + Actions (right, fixed) ======= */}
        <div className="flex flex-col items-start gap-0 lg:flex-row">
          {/* ================= LEFT: STATS CARD ================= */}
          <div className="group relative flex-1 border border-gray-600 bg-transparent p-3">
            {/* Social media icons - responsive positioning */}
            <div className="absolute top-3 right-3 hidden items-center gap-2 lg:flex">
                {token.website && (
                  <a
                  href={
                    /^https?:\/\//i.test(token.website)
                      ? token.website
                      : `https://${token.website}`
                  }
                    target="_blank"
                    rel="noopener noreferrer"
                  className="inline-flex items-center text-lg text-gray-400 hover:text-gray-300"
                  title="Website"
                  onClick={(e) => e.stopPropagation()}
                  >
                  <Globe size={20} />
                  </a>
                )}
                {token.twitter && (
                  <a
                  href={
                    /^https?:\/\//i.test(token.twitter)
                      ? token.twitter
                      : `https://${token.twitter}`
                  }
                    target="_blank"
                    rel="noopener noreferrer"
                  className="inline-flex items-center text-lg text-gray-400 hover:text-gray-300"
                  title="Social"
                  onClick={(e) => e.stopPropagation()}
                  >
                  <Twitter size={20} />
                  </a>
                )}
                {token.telegram && (
                  <a
                  href={
                    /^https?:\/\//i.test(token.telegram)
                      ? token.telegram
                      : `https://${token.telegram}`
                  }
                    target="_blank"
                    rel="noopener noreferrer"
                  className="inline-flex items-center text-lg text-gray-400 hover:text-gray-300"
                  title="Community"
                  onClick={(e) => e.stopPropagation()}
                  >
                  <MessageCircle size={20} />
                  </a>
                )}
            </div>

            {/* A-B-C Layout: (Avatar + Token+Creator) | TokenInfo+Progress */}
            <div>
              <div className="flex flex-col items-start gap-8 lg:flex-row lg:gap-8">
                {/* A+B: Avatar and Token+Creator side by side */}
                <div className="flex items-start gap-8 lg:gap-8 w-full lg:w-auto">
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                  {token.token_logo_asset_id ? (
                    <LogoContainer
                      src={`/api/media/${token.token_logo_asset_id}?v=thumb`}
                      alt={token.name}
                      baseWidth={202}
                      className="w-32 h-32 lg:w-[202px] lg:h-[202px]"
                      draggable={false}
                      onError={() => {}}
                    />
                  ) : token.image ? (
                    <ExternalImageContainer
                      src={token.image}
                      alt={token.name}
                      baseWidth={202}
                      className="w-32 h-32 lg:w-[202px] lg:h-[202px]"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-32 w-32 lg:h-[202px] lg:w-[202px] items-center justify-center bg-gradient-to-br from-purple-500 to-indigo-500 text-sm font-bold text-white">
                      {token.symbol[0]}
            </div>
          )}
                </div>

                {/* B: Token section + Creator section (stacked vertically) */}
                <div className="flex flex-col gap-4 lg:gap-6">
                  {/* Token section */}
                  <div
                    className="flex flex-col items-start text-left"
                    title={token.name}
                  >
                      <h3 className="w-full truncate text-white" style={{fontSize: '1.5rem', fontWeight: '900'}}>
                        {token.symbol}
                      </h3>

                      {/* Contract + copy */}
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span className="font-mono">
                          {token.contract_address.slice(0, 4)}...
              {token.contract_address.slice(-4)}
            </span>
            <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy();
                          }}
                          className="text-gray-400 transition hover:text-white"
                          title="Copy contract address"
                        >
                          <Copy size={12} />
            </button>
            {copied && (
                          <Check size={12} className="text-green-400" />
                        )}
                      </div>

                      {/* On DEX + Explorer links */}
                      {token.on_dex && token.dex_listing_url && (
                        <a
                          href={token.dex_listing_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-blue-400 transition-colors hover:text-blue-300"
                          title="View on DEX"
                          onClick={(e) => e.stopPropagation()}
                        >
                          On DEX <ExternalLink size={12} />
                        </a>
            )}
            <a
              href={explorerLink}
              target="_blank"
              rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-blue-400 transition-colors hover:text-blue-300"
                        title="View on Explorer"
                        onClick={(e) => e.stopPropagation()}
            >
                        On Explorer <ExternalLink size={12} />
            </a>
          </div>

                  {/* Creator section */}
                  <div className="flex-shrink-0">
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
                </div>
                </div>

                {/* C: Token name + description + progress bar */}
                <div className="mt-1 hidden lg:flex flex-col gap-3 lg:gap-5 flex-1">
                  {/* Token name and description (small gap between them) */}
                  <div className="flex flex-col gap-1">
                    {/* Token name */}
                    <div className="flex min-w-0 items-start gap-2 text-sm">
                      <span className="text-gray-400">Token name:</span>
                      <span className="truncate font-medium text-white">
                        {token.name || '—'}
                      </span>
                    </div>

                    {/* Token description */}
                    {token.description && (
                      <p
                        className="w-full overflow-hidden text-sm break-words text-gray-400 whitespace-pre-wrap"
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                          fontSize: '0.8em',
                        }}
                        title={token.description}
                      >
                        {token.description}
                      </p>
              )}
            </div>

                  {/* Progress bar - only show if token is not on DEX */}
                  {!token.on_dex && (
                    <div className="w-full">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm text-white">
                          Graduation Progress
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-400">
                            Raised: <span className="text-white">{formatETHValue(Number(token.eth_raised) || 0)}</span> of <span className="text-white">{formatETHValue(Number(token.raise_target) || 0)}</span> ETH
                          </span>
                          <span className="text-sm font-semibold text-orange-400">
                            {token.raise_target && token.eth_raised
                              ? `${Math.min(
                                  Math.floor(
                                    (Number(token.eth_raised) /
                                      Number(token.raise_target)) *
                                      100
                                  ),
                                  100
                                )}%`
                              : '0%'}
                          </span>
                        </div>
                      </div>
                      <div
                        className="relative overflow-hidden rounded-full border border-[#2a2d3a]"
                        style={{ height: '17.6px' }}
                      >
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
                          className="relative h-full overflow-hidden rounded-full transition-all duration-500 ease-out"
                          style={{
                            width:
                              token.raise_target && token.eth_raised
                                ? `${Math.min(
                                    (Number(token.eth_raised) /
                                      Number(token.raise_target)) *
                                      100,
                                    100
                                  )}%`
                                : '0%',
                          }}
                        >
                          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-500 via-blue-500 to-cyan-400 opacity-90" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Mobile version of progress info - only show if token is not on DEX */}
                {!token.on_dex && (
                  <div className="mt-2 lg:hidden">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-white">
                        Graduation Progress
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-400">
                          Raised: <span className="text-white">{formatETHValue(Number(token.eth_raised) || 0)}</span> of <span className="text-white">{formatETHValue(Number(token.raise_target) || 0)}</span> ETH
                        </span>
                        <span className="text-sm font-semibold text-orange-400">
                          {token.raise_target && token.eth_raised
                            ? `${Math.min(
                                Math.floor(
                                  (Number(token.eth_raised) /
                                    Number(token.raise_target)) *
                                    100
                                ),
                                100
                              )}%`
                            : '0%'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Stats section directly below progress bar */}
            <div className="mt-0 flex flex-wrap gap-2">
              {/* Price */}
              <div className="min-w-[140px] flex-1 border border-[#2a2d3a] px-3 py-2 sm:flex-none">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Price</span>
                  <span className="text-sm font-semibold text-white">
                    {token.current_price !== undefined &&
                    token.current_price !== null &&
                    usdPrice
                      ? formatUSDValue(getNumericPrice(), usdPrice)
                      : '—'}
                  </span>
                </div>
              </div>

              {/* FDV / Cap */}
              <div className="min-w-[140px] flex-1 border border-[#2a2d3a] px-3 py-2 sm:flex-none">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{getFDVLabel()}</span>
                  <span className="text-sm font-semibold text-white">
                    {usdPrice && getFDV() !== null
                      ? formatUSDValue(getFDV()!, usdPrice)
                      : '—'}
                  </span>
                </div>
            </div>

              {/* Holders */}
              <div className="min-w-[140px] flex-1 border border-[#2a2d3a] px-3 py-2 sm:flex-none">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Holders</span>
                  <span className="text-sm font-semibold text-white">
                    {token.holder_count !== undefined &&
                    token.holder_count !== null
                      ? formatLargeNumber(token.holder_count)
                      : '—'}
                  </span>
                </div>
            </div>

              {/* Volume 24h (only if on DEX) */}
              {token.on_dex && (
                <div className="min-w-[140px] flex-1 border border-[#2a2d3a] px-3 py-2 sm:flex-none">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      Vol <sub className="text-[10px]">24h</sub>
                    </span>
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
                <div className="min-w-[140px] flex-1 border border-[#2a2d3a] px-3 py-2 sm:flex-none">
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
              <div className="min-w-[140px] flex-1 border border-[#2a2d3a] px-3 py-2 sm:flex-none">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Supply</span>
                  <span className="text-sm font-semibold text-white">
                    {token.total_supply !== undefined &&
                    token.total_supply !== null
                      ? formatLargeNumber(Number(token.total_supply) / 1e18)
                      : '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* ===== Edit Token Info — inline inside stats (creator only) ===== */}
            {isCreator && (
              <div className="mt-2">
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="w-full border border-gray-600 bg-transparent px-5 py-2 text-sm text-gray-400 transition hover:border-gray-500"
                >
                  {isEditing ? 'Cancel Edit' : '✏️ Edit Token Info'}
                </button>

                {isEditing && (
                  <div className="mt-3 border border-[#2a2d3a] bg-transparent p-3 flex justify-center">
                    <EditTokenForm
                      token={token}
                      onSuccess={() => {
                        setIsEditing(false);
                        onRefresh();
                      }}
                      onCancel={() => setIsEditing(false)}
                    />
                  </div>
                )}
              </div>
            )}

              {/* ===== Chart Button — separate line ===== */}
              <div className="mt-2 hidden md:block">
                <button
                  onClick={() => setShowChart(!showChart)}
                  className="w-full border border-gray-600 bg-transparent px-5 py-2 text-sm text-gray-400 transition hover:border-gray-500"
                >
                  {showChart ? 'Hide Chart' : '📈 Chart'}
                </button>

                {showChart && (
                  <ChartForm 
                    onCancel={() => setShowChart(false)} 
                    tokenId={token.id} 
                    symbol={token.symbol}
                    wrapperClassName="mt-3 border border-[#2a2d3a] bg-transparent p-3"
                  />
                )}
              </div>

            {/* ===== Transaction and Holders Buttons — hidden on mobile ===== */}
            <div className="mt-2 hidden md:block">
              <div className="flex">
                <button
                  onClick={() => {
                    setShowTransactions(true);
                    setShowHolders(false);
                  }}
                  className={`flex-1 border border-r-0 px-5 py-2 text-sm transition ${
                    showTransactions
                      ? 'border-gray-500 text-white'
                      : 'border-gray-600 bg-transparent text-gray-400 hover:border-gray-500'
                  }`}
                >
                  📄 Transactions
                </button>
                <button
                  onClick={() => {
                    setShowHolders(true);
                    setShowTransactions(false);
                  }}
                  className={`flex-1 border px-5 py-2 text-sm transition ${
                    showHolders
                      ? 'border-gray-500 text-white'
                      : 'border-gray-600 bg-transparent text-gray-400 hover:border-gray-500'
                  }`}
                >
                  👥 Holders
                </button>
              </div>

              {/* Transaction Table - appears below buttons */}
              {showTransactions && (
                <div className="mt-3 border border-[#2a2d3a] bg-transparent p-3">
                  <TransactionTable
                    tokenId={token.id}
                    tokenSymbol={token.symbol}
                    creatorWallet={token.creator_wallet}
                  />
                </div>
              )}

              {/* Holders Table - appears below buttons */}
              {showHolders && (
                <div className="mt-3 border border-[#2a2d3a] bg-transparent p-3">
                  <HoldersTable tokenId={token.id} />
                </div>
              )}

            </div>
          </div>

          {/* ================= RIGHT: ACTIONS WRAPPER (stacked, no extra cards) ================= */}
          <div className="w-96 flex-shrink-0 space-y-4 border border-gray-600 bg-transparent p-3">
            {/* BUY/SELL TABBED INTERFACE - ALWAYS FIRST */}
            {!graduated && (hasPublicBuy || hasPublicSell || hasCreatorBuyLock) && (
              <div className="space-y-4">
                {/* Buy/Sell Tab Buttons */}
                <div className="flex">
                  <button
                    onClick={() => setActiveBuySellTab('buy')}
                    disabled={!hasPublicBuy && !hasCreatorBuyLock}
                    className={`flex-1 border border-r-0 px-4 py-2 text-sm transition ${
                      activeBuySellTab === 'buy'
                        ? 'border-gray-500 text-white bg-gray-700'
                        : (hasPublicBuy || hasCreatorBuyLock)
                        ? 'border-gray-600 bg-transparent text-gray-400 hover:border-gray-500'
                        : 'border-gray-600 bg-transparent text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    {hasCreatorBuyLock ? 'BUY&LOCK' : 'BUY'}
                  </button>
                  <button
                    onClick={() => setActiveBuySellTab('sell')}
                    disabled={!hasPublicSell}
                    className={`flex-1 border px-4 py-2 text-sm transition ${
                      activeBuySellTab === 'sell'
                        ? 'border-gray-500 text-white bg-gray-700'
                        : hasPublicSell
                        ? 'border-gray-600 bg-transparent text-gray-400 hover:border-gray-500'
                        : 'border-gray-600 bg-transparent text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    SELL
                  </button>
                </div>
                
                {/* Tab Content */}
                {activeBuySellTab === 'buy' && hasPublicBuy && (
                  <PublicBuySection token={token} onSuccess={onRefresh} />
                )}
                {activeBuySellTab === 'buy' && hasCreatorBuyLock && (
                  <CreatorBuySection token={token} onSuccess={onRefresh} />
                )}
                {activeBuySellTab === 'sell' && hasPublicSell && (
                  <PublicSellSection token={token} onSuccess={onRefresh} />
                )}
              </div>
            )}

            {/* CREATOR / PUBLIC ACTIONS */}
            {isCreator ? (
              <>
                {canUnlock && (
                  <div>
              <button
                      onClick={handleUnlock}
                      disabled={isUnlocking}
                      className={`w-full px-5 py-2.5 text-sm font-semibold text-white transition ${
                        isUnlocking
                          ? 'cursor-not-allowed bg-neutral-700'
                          : 'bg-gradient-to-r from-green-600 to-blue-600 hover:brightness-110'
                      }`}
                    >
                      {isUnlocking
                        ? 'Unlocking...'
                        : '🔓 Unlock Creator Tokens'}
              </button>
            </div>
          )}

              {!graduated && (
                  <AirdropForm token={token} onSuccess={onRefresh} />
                )}

                {graduated && hasAirdrops && (
                  <AirdropForm token={token} onSuccess={onRefresh} />
                )}
              </>
            ) : (
              <> 
                {graduated && <AirdropClaimForm token={token} />}
                </>
              )}
                </div>
          {/* ================= /RIGHT: ACTIONS ================= */}
        </div>
      </div>
    );
  } catch (error) {
    console.error('TokenDetailsView render error:', error);
    return (
      <div className="mx-auto mt-0 max-w-4xl bg-transparent p-6 text-white shadow-lg">
        <div className="text-center text-red-400">
          <h2 className="mb-4 text-xl font-bold">
            Error loading token details
          </h2>
          <p className="mb-4 text-sm">
            Something went wrong while loading this token.
          </p>
          <button
            onClick={onBack}
            className="text-sm text-gray-400 transition hover:text-white"
          >
            ← Back to all tokens
          </button>
        </div>
      </div>
    );
  }
}
