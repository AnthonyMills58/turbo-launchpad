'use client'

import { useState, useEffect } from 'react'
import { useAccount, useBalance } from 'wagmi'
import { ethers } from 'ethers'
import { Input } from '@/components/ui/FormInputs'
import { Token } from '@/types/token'
import { useWalletRefresh } from '@/lib/WalletRefreshContext'
import { useSync } from '@/lib/SyncContext'
import { formatPriceMetaMask } from '@/lib/ui-utils'
import { getUsdPrice } from '@/lib/getUsdPrice'
import { calculateAmountFromETH, calculateETHfromAmount, getDexPoolReserves, priceImpactBps, getAmountOut, withSlippageMin } from '@/lib/dexMath'
import { routerAbi, DEX_ROUTER_BY_CHAIN } from '@/lib/dex'
import HashDisplay from '@/components/ui/HashDisplay'

export default function DexBuySection({
  token,
  onSuccess,
}: {
  token: Token
  onSuccess?: () => void
}) {
  const { triggerSync } = useSync()
  const [amount, setAmount] = useState<number>(1.0)
  const [price, setPrice] = useState<string>('0')
  const [loadingPrice, setLoadingPrice] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [maxAvailableAmount, setMaxAvailableAmount] = useState<number>(0)
  const [usdPrice, setUsdPrice] = useState<number | null>(null)
  const [slippagePct, setSlippagePct] = useState<number>(5)
  const [pairAddress, setPairAddress] = useState<string | null>(null)
  const [token0, setToken0] = useState<string | null>(null)
  const [impactBps, setImpactBps] = useState<number | null>(null)
  const [avgRatio, setAvgRatio] = useState<number | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>('')

  const refreshWallet = useWalletRefresh()
  const isBusy = loadingPrice || isPending
  const { address } = useAccount()
  const { data: ethBalance } = useBalance({ address, query: { enabled: !!address, refetchInterval: 10_000 } })

  // Load DEX pool info and calculate max available amount
  useEffect(() => {
    const loadDexPoolInfo = async () => {
      try {
        // Get pair address from dex_pools table
        const response = await fetch(`/api/dex-pool-info?tokenId=${token.id}&chainId=${token.chain_id}`)
        if (response.ok) {
          const data = await response.json()
          if (data.pairAddress) {
            setPairAddress(data.pairAddress)
            setToken0(data.token0)
            // For now, set a reasonable max based on available liquidity
            setMaxAvailableAmount(1000000) // TODO: Calculate from actual reserves
          }
        }
      } catch (err) {
        console.error('Failed to load DEX pool info:', err)
        setMaxAvailableAmount(0)
      }
    }

    loadDexPoolInfo()
  }, [token.id, token.chain_id])

  // Calculate DEX price based on liquidity pools (debounced like BC buy)
  useEffect(() => {
    const calculateDexPrice = async () => {
      setLoadingPrice(true)
      try {
        if (!pairAddress || !token0) {
          setPrice('0')
          return
        }
        const provider = new ethers.BrowserProvider(window.ethereum)
        const chainId = token.chain_id || 0
        const ethCost = await calculateETHfromAmount(amount, pairAddress, token0, provider, chainId)
        setPrice(String(ethCost))
        // Compute price impact for exact-out (ETH in for token out)
        const reserves = await getDexPoolReserves(pairAddress, token0, provider, chainId)
        if (reserves) {
          const inWei = ethers.parseEther(String(ethCost))
          const outWei = ethers.parseEther(String(amount))
          const impact = priceImpactBps(inWei, outWei, reserves.reserveETH, reserves.reserveToken)
          setImpactBps(impact)
          // Avg price (ETH per token) vs current
          const pmid = Number(reserves.reserveETH) / Number(reserves.reserveToken) // ETH per token
          const pavg = ethCost / amount // ETH per token
          if (pmid > 0 && pavg > 0) setAvgRatio(pavg / pmid)
          else setAvgRatio(null)
        } else {
          setImpactBps(null)
          setAvgRatio(null)
        }
      } catch (err) {
        console.error('Failed to calculate DEX price:', err)
        setPrice('0')
      } finally {
        setLoadingPrice(false)
      }
    }

    if (amount > 0) {
      const timeoutId = setTimeout(() => {
        calculateDexPrice()
      }, 500)
      return () => clearTimeout(timeoutId)
    } else {
      setPrice('0')
    }
  }, [amount, pairAddress, token0, token.chain_id])

  // Load USD price for ETH
  useEffect(() => {
    getUsdPrice().then(setUsdPrice)
  }, [])

  const handleBuy = async () => {
    if (isBusy || amount <= 0 || !pairAddress || !token0) return

    setIsPending(true)
    setShowSuccess(false)
    setErrorMessage('')

    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const chainId = token.chain_id || (await signer.provider!.getNetwork()).chainId
      const router = new ethers.Contract(DEX_ROUTER_BY_CHAIN[Number(chainId)], routerAbi, signer)

      // compute amountOutMin using exact getAmountOut with fee, then apply slippage
      const reserves = await getDexPoolReserves(pairAddress, token0, provider, Number(chainId))
      if (!reserves) throw new Error('Pool reserves unavailable')
      const amountInWei = ethers.parseEther(String(price))
      const amountOutWei = getAmountOut(amountInWei, BigInt(reserves.reserveETH), BigInt(reserves.reserveToken))
      const amountOutMin = withSlippageMin(amountOutWei, slippagePct)
      const deadline = Math.floor(Date.now() / 1000) + 60
      const path = [await router.WETH(), token.contract_address]

      const tx = await router.swapExactETHForTokens(amountOutMin, path, await signer.getAddress(), deadline, { value: ethers.parseEther(String(price)) })
      setTxHash(tx.hash)
      await Promise.race([
        tx.wait(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction timeout')), 30_000)),
      ])

      setShowSuccess(true)
      if (refreshWallet) await refreshWallet()
      triggerSync()
      // Defer parent onSuccess a bit so the success banner is visible
      if (onSuccess) setTimeout(() => onSuccess(), 3000)
    } catch (err: unknown) {
      console.error('DEX Buy failed:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorMessage(msg)
    } finally {
      setIsPending(false)
    }
  }
  const priceInfo = formatPriceMetaMask(Number(price || 0))
  const totalCostEth = Number(price || 0)
  const userEthBalance = ethBalance ? parseFloat(ethBalance.formatted) : 0
  const insufficientEth = totalCostEth > userEthBalance
  const renderPrice = () => {
    if (priceInfo.type === 'empty') return '0'
    if (priceInfo.type === 'normal') {
      const value = parseFloat(priceInfo.value)
      const str = value.toString()
      const [intPart, decPart] = str.split('.')
      if (!decPart) return intPart
      let firstNonZeroIndex = -1
      for (let i = 0; i < decPart.length; i++) {
        if (decPart[i] !== '0') { firstNonZeroIndex = i; break }
      }
      if (firstNonZeroIndex === -1) return `${intPart}.0`
      const significantPart = decPart.substring(0, firstNonZeroIndex + 2)
      return `${intPart}.${significantPart}`
    }
    if (priceInfo.type === 'metamask') {
      return (<>
        0.0<sub>{priceInfo.zeros}</sub>{priceInfo.digits}
      </>)
    }
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
          balance: <span className="text-green-500">{ethBalance ? Number(ethBalance.formatted).toFixed(4) : '0.0000'} ETH</span>
        </span>
      </h3>

      <div className="flex flex-wrap gap-2 mb-3">
        {[0.001, 0.01, 0.1, 1].map((ethValue) => (
          <button
            key={ethValue}
            type="button"
            onClick={() => {
              setShowSuccess(false)
              if (!pairAddress || !token0) {
                setAmount(0)
                setPrice('0')
                return
              }
              
              // Use real DEX calculation
              const provider = new ethers.BrowserProvider(window.ethereum)
              calculateAmountFromETH(ethValue, pairAddress, token0, provider, token.chain_id || 0)
                .then(tokensToBuy => {
                  setAmount(parseFloat(tokensToBuy.toFixed(2)))
                  setPrice('0') // Will be recalculated by useEffect
                })
                .catch(err => {
                  console.error('Failed to calculate tokens from ETH:', err)
                  setAmount(0)
                  setPrice('0')
                })
            }}
            className="px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-xs"
          >
            {ethValue.toFixed(ethValue < 1 ? 3 : 0)} ETH
          </button>
        ))}
      </div>

      <Input
        type="number"
        label={`Amount to Buy `}
        name="amount"
        value={amount}
        className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
        onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
        min={1}
        max={maxAvailableAmount}
        placeholder="e.g. 1.5"
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
              ? `Avg price: x${avgRatio.toFixed(avgRatio >= 10 ? 0 : 1)}`
              : `Avg price: +${(((avgRatio||1)-1)*100).toFixed(2)}%`}
          </span>
        )}
      </div>

      {price !== '0' && (
        <>
          <div className="mt-2 text-sm text-gray-300 text-center">
            Total cost: <strong>{renderPrice()} ETH</strong>
            {/* keep ETH+USD block clean; impact info shown under slippage below */}
            {usdPrice && (
              <div className="text-xs text-gray-400 mt-1">
                ≈ ${(() => {
                  const usdValue = Number(price || 0) * usdPrice
                  const usdInfo = formatPriceMetaMask(usdValue)
                  if (usdInfo.type === 'empty') return '0'
                  if (usdInfo.type === 'normal') {
                    const value = parseFloat(usdInfo.value)
                    const str = value.toString()
                    const [intPart, decPart] = str.split('.')
                    if (!decPart) return intPart
                    let firstNonZeroIndex = -1
                    for (let i = 0; i < decPart.length; i++) {
                      if (decPart[i] !== '0') { firstNonZeroIndex = i; break }
                    }
                    if (firstNonZeroIndex === -1) return `${intPart}.0`
                    const significantPart = decPart.substring(0, firstNonZeroIndex + 2)
                    return `${intPart}.${significantPart}`
                  }
                  if (usdInfo.type === 'metamask') {
                    return (<>
                      0.0<sub>{usdInfo.zeros}</sub>{usdInfo.digits}
                    </>)
                  }
                  if (usdInfo.type === 'scientific') return usdInfo.value
                  return '0'
                })()}
              </div>
            )}
          </div>

          <button
            onClick={handleBuy}
            disabled={isPending || insufficientEth}
            className="w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-green-600 hover:bg-green-700 text-white mt-3 text-sm"
          >
            {isPending ? 'Processing...' : 'Buy Tokens'}
          </button>
          {insufficientEth && (
            <div className="mt-1 text-xs text-red-400 text-center">Insufficient ETH balance</div>
          )}
        </>
      )}

      {showSuccess && (
        <div className="mt-3 text-green-400 text-sm text-center">
          ✅ Transaction confirmed! {txHash && (<span className="ml-1"><HashDisplay hash={txHash} /></span>)}
        </div>
      )}

      {errorMessage && (
        <div className="mt-3 text-red-400 text-sm text-center">
          ❌ {errorMessage.includes('timeout') ? (
            <>
              Transaction taking longer than expected. Check block explorer for transaction: {' '}
              <HashDisplay hash={txHash || ''} className="text-red-400" />
            </>
          ) : errorMessage}
        </div>
      )}
    </div>
  )
}
