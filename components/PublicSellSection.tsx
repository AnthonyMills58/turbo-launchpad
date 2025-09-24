'use client'

import { useEffect, useState, useCallback } from 'react'
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

export default function PublicSellSection({
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
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [maxSellable, setMaxSellable] = useState<number>(0)
  const [usdPrice, setUsdPrice] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
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

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = parseFloat(e.target.value.replace(',', '.'))
    if (isNaN(val)) val = 0
    if (val < 0) val = 0
    else if (val > maxSellable) val = maxSellable
    setAmount(val)
    setShowSuccess(false)
    setErrorMessage(null)
  }

  const fetchSellPrice = useCallback(async () => {
    if (!amount || amount <= 0 || isNaN(amount)) return
    setLoadingPrice(true)
    setEthReceived('0')
    setShowSuccess(false)
    setErrorMessage(null)

    try {
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const contract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, signer)
      const amountInt = ethers.parseUnits(amount.toString(), 18)
      const priceBigInt = await contract.getSellPrice(amountInt)
      setEthReceived(ethers.formatEther(priceBigInt))
    } catch (err) {
      console.error('Failed to fetch sell price:', err)
      setEthReceived('0')
    }

    setLoadingPrice(false)
  }, [amount, token.contract_address])

  // Auto-fetch sell price when amount changes (with debounce to prevent input focus loss)
  useEffect(() => {
    if (amount > 0) {
      const timeoutId = setTimeout(() => {
        fetchSellPrice()
      }, 500) // 500ms debounce
      
      return () => clearTimeout(timeoutId)
    } else {
      setEthReceived('0')
    }
  }, [amount, fetchSellPrice])

  // Load USD price for ETH
  useEffect(() => {
    getUsdPrice().then(setUsdPrice)
  }, [])

  const handleSell = async () => {
    if (!amount || amount <= 0 || isNaN(amount)) {
      setErrorMessage('Invalid sell amount')
      return
    }

    setShowSuccess(false)
    setIsPending(true)
    setErrorMessage(null)

    try {
      const amountWei = ethers.parseUnits(amount.toString(), 18)
      const hash = await writeContractAsync({
        address: token.contract_address as `0x${string}`,
        abi: TurboTokenABI.abi,
        functionName: 'sell',
        args: [amountWei],
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
        const receipt = await Promise.race([
          publicClient.waitForTransactionReceipt({ hash: txHash }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`Transaction taking longer than expected. Check block explorer for transaction: ${txHash}`)),
              120000,
            )
          ),
        ]) as { status: 'success' | 'reverted' }

        if (receipt.status === 'success') {
          setShowSuccess(true)
          setTxHash(null)

          await fetchBalance()

          if (refreshWallet) refreshWallet()

          try {
            await fetch('/api/update-token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contractAddress: token.contract_address }),
            })

            await fetch('/api/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tokenId: token.id,
                contractAddress: token.contract_address,
                chainId: publicClient?.chain.id,
                txHash: txHash,
                operationType: 'BC_SELL',
              }),
            })
            triggerSync() // 🔁 frontendowy refresh TokenDetailsView
          } catch (err) {
            console.error('Failed to update or sync token:', err)
          }

          if (onSuccess) onSuccess()
        } else {
          setErrorMessage('❌ Contract has low ETH. Sell less or try later.')
          setTxHash(null)
        }
      } catch (err) {
        console.error('Tx failed, dropped, or timed out:', err)
        // Show user-friendly error message below the button
        setErrorMessage(`Transaction failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      } finally {
        setIsPending(false)
        setTxHash(null)
      }
    }

    waitForTx()
  }, [txHash, publicClient, refreshWallet, fetchBalance, onSuccess, token, triggerSync])

  const priceInfo = formatPriceMetaMask(Number(ethReceived || 0))
  
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

  return (
    <div className="flex flex-col flex-grow w-full bg-[#2b2e3c]/40 p-4 rounded-lg shadow border border-[#2a2d3a] mt-0 gap-1">
      <h3 className="text-white text-sm font-semibold mb-2">
        <div className="text-xs text-gray-500 mb-1 text-right">
          <sup>*</sup>BC trade
        </div>
        <span className="text-sm text-gray-400">
          Your Balance: <span className="text-green-500">{maxSellable.toLocaleString()}</span>
        </span>
      </h3>

      <div className="flex flex-wrap gap-2 mb-3">
        {[0.05, 0.10, 0.25].map((fraction) => {
          const sellAmount = maxSellable * fraction
          return (
            <button
              key={fraction}
              type="button"
              onClick={() => {
                const value = parseFloat(sellAmount.toFixed(2))
                setAmount(value)
                setShowSuccess(false)
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
        onChange={handleAmountChange}
        min={0}
        max={maxSellable}
        placeholder="e.g. 10.0"
        disabled={isBusy}
      />

      {ethReceived !== '0' && (
        <>
          {!isNaN(Number(ethReceived)) && ethReceived !== '0' && (
            <div className="mt-2 text-sm text-gray-300 text-center">
              You will receive: <strong>{renderPrice()} ETH</strong>
              {usdPrice && (
                <div className="text-xs text-gray-400 mt-1">
                  ≈ ${(() => {
                    const usdValue = Number(ethReceived || 0) * usdPrice
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
                      
                      // Take first non-zero digit + 3 more digits (4 significant digits total for USD)
                      const significantPart = decPart.substring(0, firstNonZeroIndex + 4)
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
          )}

          <button
            onClick={handleSell}
            disabled={isPending}
            className="w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-red-600 hover:bg-red-700 text-white mt-3 text-sm"
          >
            {isPending ? 'Processing...' : 'Sell Tokens'}
          </button>

          {errorMessage && (
            <div className="mt-2 text-sm text-red-400 text-center">
              {errorMessage.includes('transaction:') ? (
                <>
                  Transaction taking longer than expected. Check block explorer for transaction:{' '}
                  <HashDisplay hash={txHash || ''} className="text-red-400" />
                </>
              ) : (
                errorMessage
              )}
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





