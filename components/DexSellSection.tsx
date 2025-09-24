"use client"

import { useEffect, useState, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { Input } from '@/components/ui/FormInputs'
import { Token } from '@/types/token'
import { useWalletRefresh } from '@/lib/WalletRefreshContext'
import { useSync } from '@/lib/SyncContext'
import { formatPriceMetaMask } from '@/lib/ui-utils'
import { getUsdPrice } from '@/lib/getUsdPrice'
import { calculateETHOutFromTokens, getDexPoolReserves, priceImpactBps, getAmountOut, withSlippageMin } from '@/lib/dexMath'
import { routerAbi, DEX_ROUTER_BY_CHAIN } from '@/lib/dex'
import HashDisplay from '@/components/ui/HashDisplay'

export default function DexSellSection({
  token,
  onSuccess,
}: {
  token: Token
  onSuccess?: () => void
}) {
  const { triggerSync } = useSync()
  const [amount, setAmount] = useState<number>(1)
  const [ethReceived, setEthReceived] = useState<string>('0')
  const [loadingPrice, setLoadingPrice] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [maxSellable, setMaxSellable] = useState<number>(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [usdPrice, setUsdPrice] = useState<number | null>(null)
  const [pairAddress, setPairAddress] = useState<string | null>(null)
  const [token0, setToken0] = useState<string | null>(null)
  const [slippagePct, setSlippagePct] = useState<number>(5)
  const [impactBps, setImpactBps] = useState<number | null>(null)
  const [avgRatio, setAvgRatio] = useState<number | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [isUpdatingQuote, setIsUpdatingQuote] = useState(false)
  const quoteReqIdRef = useRef(0)
  const [phase, setPhase] = useState<'idle' | 'approving' | 'swapping'>('idle')

  const refreshWallet = useWalletRefresh()
  const isBusy = loadingPrice || isPending

  const fetchBalance = useCallback(async () => {
    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const contract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, signer)
      const balance = await contract.balanceOf(signer.address)
      const formatted = parseFloat(ethers.formatUnits(balance, 18))
      setMaxSellable(formatted)
    } catch (err) {
      console.error('Failed to fetch token balance:', err)
    }
  }, [token.contract_address])

  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])

  // Load USD
  useEffect(() => { getUsdPrice().then(setUsdPrice) }, [])

  // Load DEX pool info (pairAddress, token0)
  useEffect(() => {
    const loadDexPoolInfo = async () => {
      try {
        const response = await fetch(`/api/dex-pool-info?tokenId=${token.id}&chainId=${token.chain_id}`)
        if (response.ok) {
          const data = await response.json()
          if (data.pairAddress) {
            setPairAddress(data.pairAddress)
            setToken0(data.token0)
          }
        }
      } catch (e) {
        console.error('Failed to load DEX pool info:', e)
      }
    }
    loadDexPoolInfo()
  }, [token.id, token.chain_id])

  // Calculate DEX sell price based on liquidity pools (debounced)
  useEffect(() => {
    const calculateDexSellPrice = async () => {
      const reqId = ++quoteReqIdRef.current
      setLoadingPrice(true)
      setIsUpdatingQuote(true)
      setErrorMessage(null)
      setImpactBps(null)
      setAvgRatio(null)
      let gotValidLocal = false
      try {
        if (!pairAddress) { setEthReceived('0'); return }
        const provider = new ethers.BrowserProvider(window.ethereum)
        const totalEth = await calculateETHOutFromTokens(amount, pairAddress, token.contract_address, provider)
        if (quoteReqIdRef.current === reqId) {
          if (!Number.isNaN(totalEth) && totalEth >= 0) {
            setEthReceived(String(totalEth))
            setErrorMessage(null)
            gotValidLocal = true
          }
        }
        const reserves = await getDexPoolReserves(pairAddress, token.contract_address, provider)
        if (reserves && quoteReqIdRef.current === reqId) {
          const inWei = ethers.parseEther(String(amount))
          const outWei = ethers.parseEther(String(totalEth))
          const impact = priceImpactBps(inWei, outWei, reserves.reserveToken, reserves.reserveETH)
          setImpactBps(impact)
          // Avg price (ETH per token) vs current
          const pmid = Number(reserves.reserveETH) / Number(reserves.reserveToken) // ETH per token mid
          const pavg = totalEth / amount // ETH per token exec
          if (pmid > 0 && pavg > 0) setAvgRatio(pmid / pavg) // lower is worse -> ratio >1 shows how many times lower
          else setAvgRatio(null)
        } else {
          if (quoteReqIdRef.current === reqId) {
            setImpactBps(null)
            setAvgRatio(null)
          }
        }
      } catch (err) {
        console.error('Failed to calculate DEX sell price:', err)
        // Soft-fail: keep previous value; only show error if this attempt had no valid quote
        if (quoteReqIdRef.current === reqId) {
          if (!gotValidLocal) setErrorMessage('Failed to calculate sell price')
        }
      } finally {
        if (quoteReqIdRef.current === reqId) {
          setLoadingPrice(false)
          setIsUpdatingQuote(false)
        }
      }
    }
    if (amount > 0) {
      const t = setTimeout(() => calculateDexSellPrice(), 500)
      return () => clearTimeout(t)
    } else {
      setEthReceived('0')
    }
  }, [amount, pairAddress, token0, token.chain_id, token.contract_address])

  const priceInfo = formatPriceMetaMask(Number(ethReceived || 0))
  const renderEth = () => {
    if (priceInfo.type === 'empty') return '0'
    if (priceInfo.type === 'normal') {
      const value = parseFloat(priceInfo.value)
      const [intPart, decPart] = value.toString().split('.')
      if (!decPart) return intPart
      let i = -1
      for (let k = 0; k < decPart.length; k++) { if (decPart[k] !== '0') { i = k; break } }
      if (i === -1) return `${intPart}.0`
      const sig = decPart.substring(0, i + 2)
      return `${intPart}.${sig}`
    }
    if (priceInfo.type === 'metamask') return (<>
      0.0<sub>{priceInfo.zeros}</sub>{priceInfo.digits}
    </>)
    if (priceInfo.type === 'scientific') return priceInfo.value
    return '0'
  }

  const handleSell = async () => {
    if (isBusy || amount <= 0 || amount > maxSellable || !pairAddress) return
    setIsPending(true)
    setShowSuccess(false)
    setErrorMessage(null)
    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const chainId = token.chain_id || (await signer.provider!.getNetwork()).chainId
      const router = new ethers.Contract(DEX_ROUTER_BY_CHAIN[Number(chainId)], routerAbi, signer)

      // approve if needed
      const tokenContract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, signer)
      const owner = await signer.getAddress()
      const allowance: bigint = await tokenContract.allowance(owner, DEX_ROUTER_BY_CHAIN[Number(chainId)])
      const amountInWei = ethers.parseEther(String(amount))
      if (allowance < amountInWei) {
        setPhase('approving')
        const approveTx = await tokenContract.approve(DEX_ROUTER_BY_CHAIN[Number(chainId)], amountInWei)
        setTxHash(approveTx.hash)
        await Promise.race([
          approveTx.wait(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Approval timeout')), 120_000)),
        ])
      }

      // compute min out using proper getAmountOut
      const reserves = await getDexPoolReserves(pairAddress, token.contract_address, provider)
      if (!reserves) throw new Error('Pool reserves unavailable')
      const outWei = getAmountOut(amountInWei, BigInt(reserves.reserveToken), BigInt(reserves.reserveETH))
      const amountOutMin = withSlippageMin(outWei, slippagePct)
      const deadline = Math.floor(Date.now() / 1000) + 60
      const path = [token.contract_address, await router.WETH()]

      setPhase('swapping')
      const tx = await router.swapExactTokensForETH(amountInWei, amountOutMin, path, owner, deadline)
      setTxHash(tx.hash)
      await Promise.race([
        tx.wait(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Swap timeout')), 120_000)),
      ])

      setShowSuccess(true)
      setErrorMessage(null)
      if (refreshWallet) await refreshWallet()

      // Sync database and refresh frontend
      try {
        await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokenId: token.id,
            contractAddress: token.contract_address,
            chainId: token.chain_id,
            txHash: tx.hash,
            operationType: 'DEX_SELL',
          }),
        })
        triggerSync()
      } catch (err) {
        console.error('Failed to sync token state:', err)
        triggerSync() // Still refresh frontend even if sync fails
      }

      if (onSuccess) setTimeout(() => onSuccess(), 3000)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      // If user rejected or we timed out, show that; otherwise, for first-try hiccup, keep soft
      if (/User rejected|denied|timeout/i.test(msg)) setErrorMessage(msg)
      else if (!ethReceived || ethReceived === '0') setErrorMessage('Failed to calculate sell price')
      console.error('DEX Sell failed:', e)
    } finally {
      setIsPending(false)
      setPhase('idle')
    }
  }

  return (
    <div className="flex flex-col flex-grow w-full bg-[#232633]/40 p-4 rounded-lg shadow border border-[#2a2d3a]">
      <h3 className="text-white text-sm font-semibold mb-2">
        <div className="text-xs text-gray-500 mb-1 text-right">
          <sup>*</sup>DEX trade
        </div>
        <span className="text-sm text-gray-400">
          balance <span className="text-green-500">{maxSellable.toLocaleString()}</span>
        </span>
      </h3>

      <div className="flex flex-wrap gap-2 mb-3">
        {[0.25, 0.5, 0.75, 1].map((fraction) => {
          const sellAmount = maxSellable * fraction
          return (
            <button
              key={fraction}
              type="button"
              onClick={() => {
                const value = parseFloat(sellAmount.toFixed(2))
                setAmount(value)
                setShowSuccess(false)
                setEthReceived('0')
                setErrorMessage(null)
              }}
              className="px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-xs"
            >
              {Math.floor(fraction * 100)}%
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => {
            const value = parseFloat(maxSellable.toString())
            setAmount(value)
            setShowSuccess(false)
            setEthReceived('0')
            setErrorMessage(null)
          }}
          className="px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-xs"
        >
          Max
        </button>
      </div>

      <Input
        type="number"
        label={`Amount to Sell `}
        name="sellAmount"
        value={amount}
        className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
        onChange={(e) => { setAmount(parseFloat(e.target.value) || 0); setErrorMessage(null) }}
        min={0}
        max={maxSellable}
        step="any"
        placeholder="e.g. 10.0"
        disabled={isBusy}
      />

      <div className="-mt-2 mb-2 flex items-center gap-1">
        <span className="text-xs text-gray-400">Max Slippage %</span>
        <input
          type="number"
          name="slippage"
          value={slippagePct}
          onChange={(e) => setSlippagePct(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
          min={0}
          max={100}
          placeholder="5"
          disabled={isBusy}
          className="w-16 px-1 py-1 text-xs bg-[#232633]/40 border border-[#2a2f45] rounded focus:outline-none focus:ring focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
        />
        {impactBps !== null && (
          <span className={`ml-2 text-xs ${impactBps > 500 ? 'text-red-400' : impactBps > 200 ? 'text-yellow-400' : 'text-gray-400'}`}>
            {avgRatio && avgRatio >= 2
              ? `Avg price: x${avgRatio.toFixed(avgRatio >= 10 ? 0 : 1)} lower`
              : `Avg price: -${(((avgRatio||1)-1)*100).toFixed(2)}%`}
          </span>
        )}
      </div>

      {amount > 0 && (
        <>
          <div className="mt-2 text-sm text-gray-300 text-center">
            {isUpdatingQuote ? (
              <div className="text-xs text-gray-500">Updating…</div>
            ) : (
              <>
                You will receive: <strong>{renderEth()} ETH</strong>
                {usdPrice && (
                  <div className="text-xs text-gray-400 mt-1">
                    ≈ ${(() => {
                      const usdValue = Number(ethReceived || 0) * usdPrice
                      const usdInfo = formatPriceMetaMask(usdValue)
                      if (usdInfo.type === 'empty') return '0'
                      if (usdInfo.type === 'normal') {
                        const value = parseFloat(usdInfo.value)
                        const [intPart, decPart] = value.toString().split('.')
                        if (!decPart) return intPart
                        let i = -1
                        for (let k = 0; k < decPart.length; k++) { if (decPart[k] !== '0') { i = k; break } }
                        if (i === -1) return `${intPart}.0`
                        const sig = decPart.substring(0, i + 2)
                        return `${intPart}.${sig}`
                      }
                      if (usdInfo.type === 'metamask') return (<>
                        0.0<sub>{usdInfo.zeros}</sub>{usdInfo.digits}
                      </>)
                      if (usdInfo.type === 'scientific') return usdInfo.value
                      return '0'
                    })()}
                  </div>
                )}
              </>
            )}
            { /* end updating vs values */ }
          </div>

          <button
            onClick={handleSell}
            disabled={isPending}
            className="w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-red-600 hover:bg-red-700 text-white mt-3 text-sm"
          >
            {isPending ? (phase === 'approving' ? 'Waiting for approval…' : 'Waiting for swap…') : 'Sell Tokens'}
          </button>

          {errorMessage && !isUpdatingQuote && (
            <div className="mt-3 text-red-400 text-sm text-center">
              ❌ {errorMessage.includes('timeout') ? (
                <>
                  Transaction taking longer than expected. Check block explorer for transaction: {' '}
                  <HashDisplay hash={txHash || ''} className="text-red-400" />
                </>
              ) : errorMessage}
            </div>
          )}
        </>
      )}

      {showSuccess && (
        <div className="mt-3 text-green-400 text-sm text-center">
          ✅ Sell transaction confirmed! {txHash && (<span className="ml-1"><HashDisplay hash={txHash} /></span>)}
        </div>
      )}
    </div>
  )
}
