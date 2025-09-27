'use client'


import { useEffect, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'

type MiniHolding = {
  tokenId: number
  symbol: string
  logoUrl?: string
  amount: number
  valueEth: number
  percent: number
}

type BackerRow = {
  wallet: string
  portfolio_eth: number
  tokens_held: number
  tokens_created: number
  created_graduated: number
  created_on_dex: number
  top_holdings: MiniHolding[]
  display_name?: string | null
  bio?: string | null
  avatar_asset_id?: string | null
  eth_price_usd: number
}

const shortAddr = (a: string) => (a?.length >= 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '')

// MetaMask-style formatting function similar to CryptoChart
const formatValue = (value: number | string | null | undefined) => {
  const numValue = parseFloat(String(value || 0))
  if (!isFinite(numValue)) return '—'
  
  // Handle zero
  if (numValue === 0) return '0'
  
  const absValue = Math.abs(numValue)
  
  // Handle very small numbers with subscript zeros (MetaMask style)
  if (absValue < 0.01) {
    const str = numValue.toFixed(18)
    const match = str.match(/^0\.0*(\d+)/)
    if (match) {
      const zeros = str.indexOf(match[1]) - 2 // Count leading zeros after decimal
      const significantDigits = match[1].substring(0, 2) // First 2 significant digits
      const subscriptNumber = zeros.toString().split('').map(digit => 
        ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'][parseInt(digit)]
      ).join('')
      return `0.0${subscriptNumber}${significantDigits}`
    }
  }
  
  // Handle medium numbers
  if (absValue < 1) {
    return parseFloat(numValue.toFixed(4)).toString()
  }
  
  // Handle large numbers with K/M/B formatting
  if (absValue >= 1e12) {
    return `${parseFloat((numValue / 1e12).toFixed(2))}T`
  } else if (absValue >= 1e9) {
    return `${parseFloat((numValue / 1e9).toFixed(2))}B`
  } else if (absValue >= 1e6) {
    return `${parseFloat((numValue / 1e6).toFixed(2))}M`
  } else if (absValue >= 1e3) {
    return `${parseFloat((numValue / 1e3).toFixed(2))}K`
  }
  
  // Default formatting for numbers 1-999 (2 decimal places)
  return parseFloat(numValue.toFixed(2)).toString()
}

// Format value with ETH to USD conversion if needed
const formatDisplayValue = (value: number | string | null | undefined, label: string, ethPriceUsd: number | string | null | undefined) => {
  const numValue = parseFloat(String(value || 0))
  const numEthPrice = parseFloat(String(ethPriceUsd || 1))
  const isEthValue = label.toLowerCase().includes('eth') || label.toLowerCase().includes('portfolio')
  
  if (isEthValue) {
    const usdValue = numValue * numEthPrice
    return `$${formatValue(usdValue)}`
  }
  
  return formatValue(numValue)
}

function RoleBadge({ isCreator, isHolder }: { isCreator: boolean; isHolder: boolean }) {
  const label = isCreator && isHolder ? 'Creator & Holder' : isCreator ? 'Creator' : isHolder ? 'Holder' : 'New'
  return (
    <span className="rounded-md bg-[#243047] px-2 py-0.5 text-xs text-[#9ec1ff]">{label}</span>
  )
}

function Stat({ label, value, ethPriceUsd }: { label: string; value: number | string | null | undefined; ethPriceUsd: number | string | null | undefined }) {
  const numValue = parseFloat(String(value || 0))
  
  // Don't use formatting for "Tokens held" and "Created" - just show the number
  if (label.toLowerCase().includes('tokens held') || label.toLowerCase().includes('created')) {
    return (
      <div>
        <div className="text-[11px] text-zinc-400">{label}</div>
        <div className="font-medium">{isFinite(numValue) ? numValue.toString() : '0'}</div>
      </div>
    )
  }
  
  // Use formatting for other values (like Portfolio)
  return (
    <div>
      <div className="text-[11px] text-zinc-400">{label}</div>
      <div className="font-medium">{formatDisplayValue(value, label, ethPriceUsd)}</div>
    </div>
  )
}

function HoldingsList({ items, ethPriceUsd }: { items: MiniHolding[]; ethPriceUsd: number | string | null | undefined }) {
  if (!items || items.length === 0) {
    return <div className="text-xs text-zinc-400">No Turbo holdings yet.</div>
  }
  return (
    <div className="space-y-2">
      {items.slice(0, 3).map((h) => (
        <div key={`${h.tokenId}-${h.symbol}`} className="flex items-center gap-2">
          <div className="h-6 w-6 overflow-hidden rounded bg-[#0f111a] ring-1 ring-[#2a2d3a]">
            {h.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img 
                src={h.logoUrl} 
                alt={h.symbol} 
                className="h-full w-full object-cover" 
                onError={(e) => {
                  // Hide the image if it fails to load
                  e.currentTarget.style.display = 'none'
                }}
              />
            ) : (
              // Fallback: show first letter of symbol
              <div className="h-full w-full flex items-center justify-center text-xs text-zinc-400 font-medium">
                {h.symbol[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between text-xs">
              <span className="truncate font-medium">{h.symbol}</span>
              <span className="text-zinc-400">
                {formatValue(h.amount)} • {formatDisplayValue(h.valueEth, 'eth', ethPriceUsd)}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-[#23283a]">
              <div
                className="h-full rounded bg-gradient-to-r from-[#7b61ff] via-[#3aa0ff] to-[#25d0a6]"
                style={{ width: `${Math.max(2, Math.min(100, h.percent))}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

async function fetchBackers(chainId?: number): Promise<BackerRow[]> {
  const params = new URLSearchParams()
  if (chainId) {
    params.set('chainId', chainId.toString())
  }
  
  const response = await fetch(`/api/backers?${params}`)
  if (!response.ok) {
    throw new Error('Failed to fetch backers')
  }
  return response.json()
}

export default function BackersForm() {
  const [rows, setRows] = useState<BackerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)
  const [selectedBacker, setSelectedBacker] = useState<string | null>(null)
  const { chain } = useAccount()
  const router = useRouter()

  const handleCopyAddress = (address: string) => {
    navigator.clipboard.writeText(address)
    setCopiedAddress(address)
    setTimeout(() => setCopiedAddress(null), 1500)
  }

  const handleBackerClick = (wallet: string) => {
    setSelectedBacker(wallet)
    router.push(`/backers/${wallet}`)
  }

  useEffect(() => {
    async function loadBackers() {
      try {
        setLoading(true)
        const data = await fetchBackers(chain?.id)
        setRows(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load backers')
      } finally {
        setLoading(false)
      }
    }

    loadBackers()
  }, [chain?.id])

  if (loading) {
    return (
      <div className="w-full">
        <div className="text-center py-8 text-zinc-400">Loading backers...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full">
        <div className="text-center py-8 text-red-400">Error: {error}</div>
      </div>
    )
  }

  return (
    <div className="w-full">

      {/* Grid of cards - same layout as TokenPageContent */}
      <div className="min-h-screen bg-transparent p-2 sm:p-4 md:p-6">
        <div className="flex justify-center w-full">
          <div className="flex flex-wrap justify-center gap-8 max-w-[1600px]">
            {rows.map((r) => {
          const name = r.display_name || shortAddr(r.wallet)
          const holdings: MiniHolding[] = r.top_holdings || []
          const isCreator = (r.tokens_created || 0) > 0
          const isHolder  = (r.tokens_held || 0) > 0
          const avatarUrl = r.avatar_asset_id
            ? `/api/media/${r.avatar_asset_id}?v=thumb`
            : `https://api.dicebear.com/7.x/identicon/svg?seed=${r.wallet}&backgroundColor=0f111a&textColor=9ca3af`

          return (
            <div
              key={r.wallet}
              onClick={() => handleBackerClick(r.wallet)}
              className={`group cursor-pointer rounded-2xl p-2 border transition-all duration-300 hover:scale-[1.05] hover:shadow-2xl hover:shadow-purple-500/25 hover:border-purple-400/50 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-[#0d0f1a] w-[330px] flex-shrink-0 ${
                selectedBacker === r.wallet
                  ? 'bg-gray-800/60 ring-2 ring-purple-400 border-purple-500'
                  : 'bg-gray-800/60 border-[#2a2d3a] hover:bg-gray-700/60 hover:border-[#3a3d4a]'
              }`}
            >
              {/* Header */}
              <div className="flex items-start gap-3">
                <div className="relative h-14 w-14 overflow-hidden rounded-lg bg-[#0f111a] ring-1 ring-[#2a2d3a]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate font-semibold">{name}</div>
                    <RoleBadge isCreator={isCreator} isHolder={isHolder} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-400">
                    <span>{shortAddr(r.wallet)}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCopyAddress(r.wallet)
                      }}
                      className="text-zinc-400 hover:text-white transition-colors"
                    >
                      {copiedAddress === r.wallet ? (
                        <Check size={12} className="text-green-400" />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </div>
                  {r.bio && <div className="mt-2 line-clamp-2 text-xs text-zinc-300">{r.bio}</div>}
                </div>
              </div>

              {/* Stats */}
              <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg border border-[#2a2d3a] bg-[#151827] p-2 text-sm">
                <Stat label="Portfolio"    value={Number(r.portfolio_eth || 0)} ethPriceUsd={r.eth_price_usd || 1} />
                <Stat label="Tokens held"  value={r.tokens_held ?? 0} ethPriceUsd={r.eth_price_usd || 1} />
                <Stat label="Created"      value={r.tokens_created ?? 0} ethPriceUsd={r.eth_price_usd || 1} />
                <Stat label="Graduated"    value={r.created_graduated ?? 0} ethPriceUsd={r.eth_price_usd || 1} />
              </div>

              {/* Holdings preview */}
              <div className="mt-3">
                <HoldingsList items={holdings} ethPriceUsd={r.eth_price_usd || 1} />
              </div>

              {/* Footer */}
              <div className="mt-3 flex items-center justify-between">

              </div>
            </div>
          )
        })}
          </div>
        </div>
      </div>
    </div>
  )
}

