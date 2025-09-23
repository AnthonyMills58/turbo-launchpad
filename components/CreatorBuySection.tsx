'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePublicClient, useWriteContract } from 'wagmi'
import { ethers } from 'ethers'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { Input } from '@/components/ui/FormInputs'
import { Token } from '@/types/token'
import { useWalletRefresh } from '@/lib/WalletRefreshContext'
import { useSync } from '@/lib/SyncContext'
import { formatPriceMetaMask } from '@/lib/ui-utils'
import HashDisplay from '@/components/ui/HashDisplay'
import { getUsdPrice } from '@/lib/getUsdPrice'

type Props = {
  token: Token
  onSuccess?: () => void
}

export default function CreatorBuySection({ token, onSuccess }: Props) {
  const { triggerSync } = useSync()
  const [amount, setAmount] = useState<number>(1.0)
  const [price, setPrice] = useState<string>('0')
  const [loadingPrice, setLoadingPrice] = useState(false)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>('')

  const [maxAllowedAmount, setMaxAllowedAmount] = useState<number>(0)
  const [lifetimeLeft, setLifetimeLeft] = useState<number>(0)
  const [isCreatorWallet, setIsCreatorWallet] = useState<boolean>(false)
  const [lockingClosed, setLockingClosed] = useState<boolean>(false) // ✅ respect contract flag
  const [usdPrice, setUsdPrice] = useState<number | null>(null)

  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const refreshWallet = useWalletRefresh()

  // Load caps and the on-chain "closed" flag
  // maxAllowed = 0 if creatorLockingClosed == true
  // otherwise: min( maxSaleSupply - totalSupply, maxCreatorLock - creatorLockCumulative )
  useEffect(() => {
    const loadCaps = async () => {
      try {
        if (!window.ethereum || !token?.contract_address) return
        const provider = new ethers.BrowserProvider(window.ethereum)
        const signer = await provider.getSigner()
        const signerAddr = await signer.getAddress()

        const contract = new ethers.Contract(
          token.contract_address,
          TurboTokenABI.abi,
          signer
        )

        // Prefer on-chain creator (fallback to DB)
        let creatorAddr: string
        try {
          const info = await contract.tokenInfo()
          creatorAddr = String(info._creator)
        } catch {
          creatorAddr = token.creator_wallet
        }

        const isCreator = creatorAddr.toLowerCase() === signerAddr.toLowerCase()
        setIsCreatorWallet(isCreator)

        if (!isCreator) {
          setLockingClosed(false)
          setMaxAllowedAmount(0)
          setLifetimeLeft(0)
          setAmount(0)
          return
        }

        // Read flags + caps
        const [
          totalSupplyWei,
          maxSaleWei,
          maxCreatorLockWei,
          lockCumWeiRaw,
          closedRaw
        ] = await Promise.all([
          contract.totalSupply(),
          contract.maxSaleSupply(),
          contract.maxCreatorLock(),
          // lifetime cumulative (fallback to lockedBalances for extreme legacy)
          (async () => {
            try { return await contract.creatorLockCumulative() } 
            catch {
              try { return await contract.lockedBalances(creatorAddr) } 
              catch { return 0n }
            }
          })(),
          // on-chain close flag (e.g., set true after unlock on your current contract)
          (async () => {
            try { return await contract.creatorLockingClosed() } 
            catch { return false }
          })(),
        ])

        const closed = Boolean(closedRaw)
        setLockingClosed(closed)

        if (closed) {
          // Once closed, disable the feature entirely
          setMaxAllowedAmount(0)
          setLifetimeLeft(0)
          setAmount(0)
          return
        }

        const saleRemainingWei = maxSaleWei > totalSupplyWei ? (maxSaleWei - totalSupplyWei) : 0n
        const lifeRemainingWei = maxCreatorLockWei > lockCumWeiRaw ? (maxCreatorLockWei - lockCumWeiRaw) : 0n

        const saleRemaining = Number(ethers.formatUnits(saleRemainingWei, 18))
        const lifetimeRemaining = Number(ethers.formatUnits(lifeRemainingWei, 18))

        const remaining = Math.max(0, Math.min(saleRemaining, lifetimeRemaining))

        setLifetimeLeft(Math.max(0, lifetimeRemaining))
        setMaxAllowedAmount(remaining)
        setAmount(a => Math.min(a, remaining || 0))
      } catch (e) {
        console.error('[CreatorBuy] loadCaps failed', e)
        setLockingClosed(false)
        setMaxAllowedAmount(0)
        setLifetimeLeft(0)
        setAmount(0)
      }
    }

    void loadCaps()
  }, [token?.contract_address, token?.creator_wallet])

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = parseFloat(e.target.value)
    if (Number.isNaN(val)) val = 1
    if (val < 1) val = 1
    if (val > maxAllowedAmount) val = maxAllowedAmount
    setAmount(val)
    setShowSuccess(false)
    setErrorMessage('')
  }

  const fetchPrice = useCallback(async () => {
    if (!amount || amount <= 0 || !isCreatorWallet || lockingClosed) return
    setShowSuccess(false)
    setLoadingPrice(true)
    setPrice('0')
    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const contract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, signer)
      const amountInt = ethers.parseUnits(amount.toString(), 18)
      const priceBigInt: bigint = await contract.getPrice(amountInt)
      setPrice(ethers.formatEther(priceBigInt))
    } catch (err) {
      console.error('Failed to fetch price:', err)
      setPrice('0')
    }
    setLoadingPrice(false)
  }, [amount, isCreatorWallet, lockingClosed, token.contract_address])

  // Auto-fetch price when amount changes (with debounce to prevent input focus loss)
  useEffect(() => {
    if (amount > 0 && isCreatorWallet && !lockingClosed) {
      const timeoutId = setTimeout(() => {
        fetchPrice()
      }, 500) // 500ms debounce
      
      return () => clearTimeout(timeoutId)
    } else {
      setPrice('0')
    }
  }, [amount, isCreatorWallet, lockingClosed, fetchPrice])

  // Load USD price for ETH
  useEffect(() => {
    getUsdPrice().then(setUsdPrice)
  }, [])

  const handleBuy = async () => {
    if (!amount || price === '0' || !isCreatorWallet || lockingClosed) return
    setShowSuccess(false)
    setErrorMessage('')
    setIsPending(true)
    try {
      const amountWei = ethers.parseUnits(amount.toString(), 18)
      const hash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'creatorBuy',
        args: [amountWei],
        value: ethers.parseEther(price),
      })
      setTxHash(hash)
    } catch (err) {
      console.error('Transaction failed:', err)
      setIsPending(false)
    }
  }

  useEffect(() => {
    if (!txHash || !publicClient) return

    const waitForTx = async () => {
      try {
        // Add timeout to prevent hanging indefinitely (30 seconds should be enough for most transactions)
        await Promise.race([
          publicClient.waitForTransactionReceipt({ hash: txHash }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Transaction taking longer than expected. Check block explorer for transaction: ${txHash}`)), 30000) // 30 second timeout
          )
        ])

        setShowSuccess(true)
        setTxHash(null)
        if (refreshWallet) refreshWallet()

        try {
          await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tokenId: token.id,
              contractAddress: token.contract_address,
              chainId: publicClient?.chain.id,
            }),
          })
          // bump refreshKey ⇒ remount TokenDetailsView
          triggerSync()
        } catch (err) {
          console.error('Failed to sync token state:', err)
        }

        if (onSuccess) onSuccess()
      } catch (err) {
        console.error('Tx failed, dropped, or timed out:', err)
        // Show user-friendly error message below the button
        setErrorMessage(`Transaction failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      } finally {
        setIsPending(false)
        setTxHash(null)
      }
    }

    void waitForTx()
  }, [txHash, publicClient, refreshWallet, onSuccess, token.id, token.contract_address, triggerSync])

  const priceInfo = formatPriceMetaMask(Number(price || 0))
  
  const renderPrice = () => {
    if (priceInfo.type === 'empty') return '0'
    if (priceInfo.type === 'normal') {
      // For normal display, show only 1 digit after first non-zero digit
      const value = parseFloat(priceInfo.value)
      const str = value.toString()
      const [intPart, decPart] = str.split('.')
      
      if (!decPart) return intPart
      
      // Find first non-zero digit
      let firstNonZeroIndex = -1
      for (let i = 0; i < decPart.length; i++) {
        if (decPart[i] !== '0') {
          firstNonZeroIndex = i
          break
        }
      }
      
      if (firstNonZeroIndex === -1) return `${intPart}.0`
      
      // Take first non-zero digit + 1 more digit
      const significantPart = decPart.substring(0, firstNonZeroIndex + 2)
      return `${intPart}.${significantPart}`
    }
    if (priceInfo.type === 'metamask') {
      return (
        <>
          0.0<sub>{priceInfo.zeros}</sub>{priceInfo.digits}
        </>
      )
    }
    if (priceInfo.type === 'scientific') return priceInfo.value
    return '0'
  }
  const isBusy = loadingPrice || isPending

  
  return (
    <div className="flex flex-col flex-grow w-full bg-[#232633]/40 p-4 rounded-lg shadow border border-[#2a2d3a]">
      <h3 className="text-white text-sm font-semibold mb-2">
        <div className="text-xs text-gray-500 mb-1 text-right">
          <sup>*</sup>BC trade
        </div>
        Creator Buy &amp; Lock
        <br />
        <span className="text-sm text-gray-400">
          max available:{' '}
          <span className="text-green-500">
            {lifetimeLeft.toLocaleString()} 
          </span>
        </span>
      </h3>

      {!isCreatorWallet && (
        <div className="text-xs text-gray-400 mb-3">
          Only the creator wallet can use Buy &amp; Lock.
        </div>
      )}

      {lockingClosed && (
        <div className="text-xs text-amber-400 mb-3 border border-amber-500/30 rounded-md p-2 bg-amber-500/10">
          Buy&nbsp;&amp;&nbsp;Lock is closed by the contract (e.g., after unlock or lifetime cap fully used).
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        {[0.1, 0.25, 0.5, 0.75].map((fraction) => {
          const tokenAmount = lifetimeLeft * fraction
          return (
            <button
              key={fraction}
              type="button"
              onClick={() => {
                setShowSuccess(false)
                setErrorMessage('')
                const amount = parseFloat(tokenAmount.toFixed(2))
                setAmount(amount)
              }}
              className="px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-xs disabled:opacity-50"
              disabled={!isCreatorWallet || lockingClosed || maxAllowedAmount <= 0}
            >
              {Math.floor(fraction * 100)}%
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => {
            setShowSuccess(false)
            setErrorMessage('')
            setAmount(parseFloat(lifetimeLeft.toFixed(2)))
          }}
          className="px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-xs disabled:opacity-50"
          disabled={!isCreatorWallet || lockingClosed || maxAllowedAmount <= 0}
        >
          MAX
        </button>
      </div>

      <Input
        type="number"
        label="Amount to Buy & Lock"
        name="amount"
        value={amount}
        className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
        onChange={handleAmountChange}
        min={1}
        max={maxAllowedAmount}
        placeholder="e.g. 1.5"
        disabled={isBusy || !isCreatorWallet || lockingClosed || maxAllowedAmount <= 0}
      />

      {price !== '0' && (
        <>
          <div className="mt-2 text-sm text-gray-300 text-center">
            Total cost: <strong>{renderPrice()} ETH</strong>
            {usdPrice && (
              <div className="text-xs text-gray-400 mt-1">
                ≈ ${(() => {
                  const usdValue = Number(price || 0) * usdPrice
                  const usdInfo = formatPriceMetaMask(usdValue)
                  
                  if (usdInfo.type === 'empty') return '0'
                  if (usdInfo.type === 'normal') {
                    // For USD normal format, show only first two significant digits after decimal
                    const value = parseFloat(usdInfo.value)
                    const str = value.toString()
                    const [intPart, decPart] = str.split('.')
                    
                    if (!decPart) return intPart
                    
                    // Find first non-zero digit
                    let firstNonZeroIndex = -1
                    for (let i = 0; i < decPart.length; i++) {
                      if (decPart[i] !== '0') {
                        firstNonZeroIndex = i
                        break
                      }
                    }
                    
                    if (firstNonZeroIndex === -1) return `${intPart}.0`
                    
                    // Take first non-zero digit + 1 more digit (2 significant digits total)
                    const significantPart = decPart.substring(0, firstNonZeroIndex + 2)
                    return `${intPart}.${significantPart}`
                  }
                    if (usdInfo.type === 'metamask') {
                      return (
                        <>
                          0.0<sub>{usdInfo.zeros}</sub>{usdInfo.digits}
                        </>
                      )
                    }
                  if (usdInfo.type === 'scientific') return usdInfo.value
                  return '0'
                })()}
              </div>
            )}
          </div>

          <button
            onClick={handleBuy}
            disabled={isPending || maxAllowedAmount <= 0 || !isCreatorWallet || lockingClosed}
            className="w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-green-600 hover:bg-green-700 text-white mt-3 text-sm"
          >
            {isPending ? 'Processing...' : 'Buy & Lock'}
          </button>
        </>
      )}

      {showSuccess && (
        <div className="mt-3 text-green-400 text-sm text-center">
          ✅ Transaction confirmed!
        </div>
      )}

      {errorMessage && (
        <div className="mt-3 text-red-400 text-sm text-center">
          ❌ {errorMessage.includes('transaction:') ? (
            <>
              Transaction taking longer than expected. Check block explorer for transaction:{' '}
              <HashDisplay 
                hash={txHash || errorMessage.match(/transaction: (0x[a-fA-F0-9]+)/)?.[1] || ''} 
                className="text-red-400" 
              />
            </>
          ) : (
            errorMessage
          )}
        </div>
      )}
    </div>
  )
}



























