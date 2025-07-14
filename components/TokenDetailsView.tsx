'use client'
import { ethers } from 'ethers'
import { Token } from '@/types/token'
import { useAccount, useChainId, usePublicClient, useWriteContract } from 'wagmi'
import { useState, useEffect } from 'react'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import CreatorBuySection from './CreatorBuySection'
import WithdrawForm from './WithdrawForm'
import PublicBuySection from './PublicBuySection'
import AirdropForm from './AirdropForm'
import AirdropClaimForm from './AirdropClaimForm'
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from '@/lib/chains'
import { Copy } from 'lucide-react'
import EditTokenForm from './EditTokenForm'
import PublicSellSection from './PublicSellSection'
import { useSync } from '@/lib/SyncContext'



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
  const [copiedJSON, setCopiedJSON] = useState(false)
  const [isGraduating, setIsGraduating] = useState(false)
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [dexUrl, setDexUrl] = useState(token.dex_listing_url || '')
  const [isSubmittingDex, setIsSubmittingDex] = useState(false)
  const [dexSubmitSuccess, setDexSubmitSuccess] = useState(false)
  const [dexSubmitError, setDexSubmitError] = useState(false)

  const isCreator = address?.toLowerCase() === token.creator_wallet.toLowerCase()
  const isGraduated = token.is_graduated
  const raised = token.eth_raised
  const cap = token.raise_target
  const canGraduate = isCreator && !isGraduated && raised >= cap



  const chainMap = {
    [megaethTestnet.id]: megaethTestnet,
    [megaethMainnet.id]: megaethMainnet,
    [sepoliaTestnet.id]: sepoliaTestnet,
  }

  const chain = chainMap[chainId]
  const explorerBaseUrl = chain?.blockExplorers?.default.url ?? ''


  const explorerLink = `${explorerBaseUrl}/address/${token.contract_address}`

  const dexMetadata = {
    name: token.name,
    symbol: token.symbol,
    address: token.contract_address,
    decimals: 18,
    chainId,
    logoURI: token.image || '',
    website: token.website || '',
    description: token.description || '',
    creator: token.creator_wallet,
    tags: ['launchpad', isGraduated ? 'graduated' : 'in-progress'],
  }

  const handleGraduate = async () => {
    try {
      if (!publicClient) return
      setIsGraduating(true)

      const txHash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'graduate',
      })

      await publicClient.waitForTransactionReceipt({ hash: txHash })

      // 1. Update token fast fields
      await fetch('/api/update-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress: token.contract_address }),
      })

      // 2. Sync full on-chain state to DB
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: token.id,
          contractAddress: token.contract_address,
          chainId, // ✅ include current chain ID
        }),
      })
      triggerSync() // 🔁 frontendowy refresh TokenDetailsView

      onBack()
    } catch (err) {
      console.error('❌ Graduation failed:', err)
    } finally {
      setIsGraduating(false)
    }
  }


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

      // 1. Fast update
      await fetch('/api/update-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress: token.contract_address }),
      })

      // 2. Sync on-chain state into DB
      await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: token.id,
          contractAddress: token.contract_address,
          chainId, // ✅ include current chain ID
        }),
      })
      triggerSync() // 🔁 frontendowy refresh TokenDetailsView

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

  const handleCopyJSON = () => {
    navigator.clipboard.writeText(JSON.stringify(dexMetadata, null, 2))
    setCopiedJSON(true)
    setTimeout(() => setCopiedJSON(false), 1500)
  }

  const handleDownloadJSON = () => {
    const blob = new Blob([JSON.stringify(dexMetadata, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${token.symbol}_metadata.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleMarkDexListing = async () => {
    try {
      if (!dexUrl) return
      setIsSubmittingDex(true)
      setDexSubmitError(false)
      const res = await fetch('/api/mark-dex-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: token.contract_address,
          dexUrl,
        }),
      })
      if (!res.ok) throw new Error('Failed to update DEX status')
      setDexSubmitSuccess(true)
      onRefresh()
    } catch (err) {
      console.error('❌ Failed to mark DEX listing:', err)
      setDexSubmitError(true)
    } finally {
      setIsSubmittingDex(false)
      setTimeout(() => setDexSubmitSuccess(false), 2000)
    }
  }

 const [userTokenBalance, setUserTokenBalance] = useState<number | null>(null)

useEffect(() => {
  const fetchTokenBalance = async () => {
    try {
      if (!window.ethereum || !token?.contract_address) return

      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const contract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, signer)
      const balance = await contract.balanceOf(await signer.getAddress())
      const formatted = parseFloat(ethers.formatUnits(balance, 18))
      setUserTokenBalance(formatted)
    } catch (err) {
      console.error('Failed to fetch user token balance:', err)
    }
  }

  fetchTokenBalance()
}, [token.contract_address])


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

          {(token.website || token.twitter || token.telegram) && (
            <div className="mb-4 text-sm">
              <div className="flex flex-wrap gap-4 text-blue-400">
                {token.website && (
                  <a href={token.website} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1">
                    🌐 <span className="underline">Website</span>
                  </a>
                )}
                {token.twitter && (
                  <a href={token.twitter} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1">
                    🐦 <span className="underline">Social</span>
                  </a>
                )}
                {token.telegram && (
                  <a href={token.telegram} target="_blank" rel="noopener noreferrer" className="hover:underline flex items-center gap-1">
                    💬 <span className="underline">Community</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Contract Info */}
          <div className="flex items-center flex-wrap mb-4 space-x-2 font-mono text-sm text-gray-400 select-all">
            <span>Contract:</span>
            <span>{token.contract_address.slice(0, 6)}...{token.contract_address.slice(-4)}</span>
            <button onClick={handleCopy} className="text-gray-400 hover:text-white transition"><Copy size={16} /></button>
            {copied && <span className="text-green-400 ml-2 text-xs">Copied!</span>}
            <a href={explorerLink} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline ml-4 text-xs">View on Explorer</a>
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

            <div>
              <span className="font-semibold text-white">Raised</span>
              <p>{Number(raised).toFixed(6).replace(/\.?0+$/, '')} / {cap} ETH</p>
            </div>
            <div>
              <span className="font-semibold text-white">Current Price</span>
              <p>
                {token.current_price !== undefined
                  ? `${Number(token.current_price).toFixed(10).replace(/\.?0+$/, '')} ETH`
                  : '–'}
              </p>
            </div>
            <div>
              <span className="font-semibold text-white">Max Supply</span>
              <p>{Number(token.supply).toLocaleString()}</p>
            </div>
            <div>
              <span className="font-semibold text-white">Locked by Creator</span>
              <p>{token.creator_lock_amount ? Number(token.creator_lock_amount).toFixed(0) : '0'}</p>
            </div>
            <div>
              <span className="font-semibold text-white">FDV</span>
              <p>
                {token.fdv !== undefined
                  ? `${Number(token.fdv).toFixed(6).replace(/\.?0+$/, '')} ETH`
                  : '–'}
              </p>
            </div>
            {token.market_cap !== undefined && (
              <div>
                <span className="font-semibold text-white">Market Cap</span>
                <p className="text-sm text-white">
                  {Number(token.market_cap).toFixed(6).replace(/\.?0+$/, '')} ETH
                  {usdPrice && (
                    <span className="text-gray-400"> (${(token.market_cap * usdPrice).toFixed(2)})</span>
                  )}
                </p>
              </div>
            )}
          </div>



          {/* Creator Actions */}
          {isCreator && (
            <div className="flex flex-col space-y-4">
              {/* Buy & Airdrop in one row on desktop */}
              {!isGraduated && (
                <div className="flex flex-col md:flex-row md:items-start gap-4">
                  <CreatorBuySection token={token} onSuccess={onRefresh} />
                  <AirdropForm token={token} onSuccess={onRefresh} />
                </div>
              )}

              {/* Graduate Button */}
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

              {/* Unlock Button */}
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

              {/* Withdraw Form */}
              {isGraduated && Number(raised) > 0 && (
                <WithdrawForm token={token} onSuccess={onRefresh} />
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
                  onCancel={() => setIsEditing(false)} // ✅ required prop
                />
              )}

            </div>
          )}


          {!isCreator && (
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





          {/* DEX JSON + Deployment Form */}
          {isCreator && isGraduated && !token.on_dex && (
            <>
              {/* JSON Metadata Section */}
              <div className="mb-6">
                <h2 className="text-white font-semibold text-lg mb-2">DEX Metadata</h2>
                <pre className="bg-black text-green-400 text-xs p-4 rounded overflow-auto max-h-60 border border-gray-700">
                  {JSON.stringify(dexMetadata, null, 2)}
                </pre>
                <div className="flex gap-4 mt-2">
                  <button
                    onClick={handleCopyJSON}
                    className="bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 text-sm"
                  >
                    📋 Copy JSON
                  </button>
                  <button
                    onClick={handleDownloadJSON}
                    className="bg-purple-600 text-white px-3 py-1.5 rounded hover:bg-purple-700 text-sm"
                  >
                    💾 Download JSON
                  </button>
                  {copiedJSON && <span className="text-green-400 text-xs mt-2">Copied!</span>}
                </div>
              </div>

              {/* DEX Deployment Form */}
              <div className="mt-6">
                <h2 className="text-white font-semibold text-lg mb-2">Mark Token as Deployed to DEX</h2>
                <input
                  type="url"
                  placeholder="Enter DEX listing URL (e.g. https://...)"
                  className="w-full px-4 py-2 text-sm bg-gray-800 text-white rounded border border-gray-600 focus:outline-none"
                  value={dexUrl}
                  onChange={(e) => setDexUrl(e.target.value)}
                />
                <button
                  onClick={handleMarkDexListing}
                  disabled={isSubmittingDex || !dexUrl}
                  className={`mt-2 w-full px-5 py-2.5 rounded-md font-semibold text-white text-sm transition ${
                    isSubmittingDex || !dexUrl
                      ? 'bg-neutral-700 cursor-not-allowed'
                      : 'bg-gradient-to-r from-yellow-500 to-pink-500 hover:brightness-110'
                  }`}
                >
                  {isSubmittingDex ? 'Submitting...' : '📡 Mark as Deployed to DEX'}
                </button>
                {dexSubmitSuccess && (
                  <p className="text-green-400 text-sm mt-2">✅ Token marked as deployed!</p>
                )}
                {dexSubmitError && (
                  <p className="text-red-400 text-sm mt-2">❌ Failed to mark deployment. Try again.</p>
                )}
              </div>
            </>
          )}

          {/* If token is already deployed, optionally show a link */}
          {isCreator && isGraduated && token.on_dex && token.dex_listing_url && (
            <div className="mt-6">
              <h2 className="text-white font-semibold text-lg mb-2">✅ Token is Deployed to DEX</h2>
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

        </div>
      </div>
    </div>
  )
}








