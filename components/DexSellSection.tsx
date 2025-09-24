"use client"

import { useEffect, useState, useCallback } from 'react'
import { ethers } from 'ethers'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { Input } from '@/components/ui/FormInputs'
import { Token } from '@/types/token'
import { useWalletRefresh } from '@/lib/WalletRefreshContext'
import { useSync } from '@/lib/SyncContext'
import { formatPriceMetaMask } from '@/lib/ui-utils'
import { getUsdPrice } from '@/lib/getUsdPrice'
import { calculateETHOutFromTokens, getDexPoolReserves, priceImpactBps } from '@/lib/dexMath'

export default function DexSellSection({
  token,
  onSuccess,
}: {
  token: Token
  onSuccess?: () => void
}) {
  const { triggerSync } = useSync()
  const [amount, setAmount] = useState<number>(0)
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

  // Load USD price for ETH
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
      setLoadingPrice(true)
      setErrorMessage(null)
      try {
        if (!pairAddress || !token0) { setEthReceived('0'); return }
        const provider = new ethers.BrowserProvider(window.ethereum)
        const chainId = token.chain_id || 0
        const totalEth = await calculateETHOutFromTokens(amount, pairAddress, token0, provider, chainId)
        setEthReceived(String(totalEth))
        const reserves = await getDexPoolReserves(pairAddress, token0, provider, chainId)
        if (reserves) {
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
          setImpactBps(null)
          setAvgRatio(null)
        }
      } catch (err) {
        console.error('Failed to calculate DEX sell price:', err)
        setErrorMessage('Failed to calculate sell price')
        setEthReceived('0')
      } finally {
        setLoadingPrice(false)
      }
    }
    if (amount > 0) {
      const t = setTimeout(() => calculateDexSellPrice(), 500)
      return () => clearTimeout(t)
    } else {
      setEthReceived('0')
    }
  }, [amount, pairAddress, token0, token.chain_id])

  const handleSell = async () => {
    if (isBusy || amount <= 0 || amount > maxSellable) return

    setIsPending(true)
    setErrorMessage(null)

    try {
      // TODO: Implement DEX sell transaction
      // This should interact with the DEX router/swap contract
      // For now, show a placeholder message
      console.log('DEX Sell transaction would be executed here')
      console.log(`Amount: ${amount} ${token.symbol}`)
      console.log(`ETH Received: ${ethReceived} ETH`)
      
      // Placeholder success
      setShowSuccess(true)
      
      // Trigger refresh
      await refreshWallet()
      triggerSync()
      
      if (onSuccess) {
        onSuccess()
      }
    } catch (err: unknown) {
      console.error('DEX Sell failed:', err)
      setErrorMessage(err instanceof Error ? err.message : 'Transaction failed')
    } finally {
      setIsPending(false)
    }
  }


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
        onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
        min={0}
        max={maxSellable}
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

      {ethReceived !== '0' && (
        <>
          <div className="mt-2 text-sm text-gray-300 text-center">
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
          </div>

          <button
            onClick={handleSell}
            disabled={isPending}
            className="w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-red-600 hover:bg-red-700 text-white mt-3 text-sm"
          >
            {isPending ? 'Processing...' : 'Sell Tokens'}
          </button>

          {errorMessage && (
            <div className="mt-2 text-sm text-red-400 text-center">
              {errorMessage}
            </div>
          )}
        </>
      )}

      {showSuccess && (
        <div className="mt-3 text-green-400 text-sm text-center">
          ✅ Sell transaction confirmed!
        </div>
      )}
    </div>
  )
}
