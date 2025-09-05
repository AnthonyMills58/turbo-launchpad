'use client'

import { useState, useEffect } from 'react'
import { usePublicClient, useWriteContract } from 'wagmi'
import { ethers } from 'ethers'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { Input } from '@/components/ui/FormInputs'
import { Token } from '@/types/token'
import { useWalletRefresh } from '@/lib/WalletRefreshContext'
import { calculateBuyAmountFromETH } from '@/lib/calculateBuyAmount'
import { useSync } from '@/lib/SyncContext'
import { formatValue } from '@/lib/displayFormats'

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

  const [maxAllowedAmount, setMaxAllowedAmount] = useState<number>(0)
  const [lifetimeLeft, setLifetimeLeft] = useState<number>(0)
  const [isCreatorWallet, setIsCreatorWallet] = useState<boolean>(false)
  const [lockingClosed, setLockingClosed] = useState<boolean>(false) // ✅ respect contract flag

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
    setPrice('0')
    setShowSuccess(false)
  }

  const fetchPrice = async () => {
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
  }

  const handleBuy = async () => {
    if (!amount || price === '0' || !isCreatorWallet || lockingClosed) return
    setShowSuccess(false)
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
        await publicClient.waitForTransactionReceipt({ hash: txHash })

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
        console.error('Tx failed or dropped:', err)
      } finally {
        setIsPending(false)
      }
    }

    void waitForTx()
  }, [txHash, publicClient, refreshWallet, onSuccess, token.id, token.contract_address, triggerSync])

  const displayPrice = formatValue(Number(price || 0))
  const isBusy = loadingPrice || isPending

  
  return (
    <div className="flex flex-col flex-grow max-w-xs bg-[#232633] p-4 rounded-lg shadow border border-[#2a2d3a]">
      <h3 className="text-white text-sm font-semibold mb-2">
        Creator Buy &amp; Lock
        <br />
        <span className="text-sm text-gray-400">
          lifetime left:{' '}
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
          {[1 / 10000, 1 / 1000, 1 / 100, 1 / 10].map((fraction) => {
          const ethAmount = token.raise_target * fraction
          return (
            <button
              key={fraction}
              type="button"
              onClick={async () => {
              setShowSuccess(false);
              if (!isCreatorWallet) return;
              try {
                // 1) Convert preset ETH (number) → wei (bigint)
                const ethWei = BigInt(Math.floor(ethAmount * 1e18));

                // 2) Read current price from chain
                const provider = new ethers.BrowserProvider(window.ethereum);
                const signer = await provider.getSigner();
                const contract = new ethers.Contract(
                  token.contract_address,
                  TurboTokenABI.abi,
                  signer
                );

                const currentPriceWei = await contract.getCurrentPrice(); // bigint

                const calculated = calculateBuyAmountFromETH(
                  ethWei,                                   // ETH in wei (bigint)
                  BigInt(currentPriceWei.toString()),       // price in wei/token (bigint)
                  BigInt(Math.floor(token.slope))           // slope (bigint from DB number)
                );

               
                const rounded = Math.min(calculated, maxAllowedAmount);
                const precise = parseFloat(rounded.toFixed(2));

                setAmount(precise);
                setPrice('0');
              } catch (err) {
                console.error('Curve calc error:', err);
              }
            }}

              className="px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-xs disabled:opacity-50"
              disabled={!isCreatorWallet || lockingClosed || maxAllowedAmount <= 0}
            >
              {parseFloat(ethAmount.toFixed(6)).toString()} ETH
            </button>
          )
        })}
      </div>

      <Input
        type="number"
        label="Amount to Buy & Lock"
        name="amount"
        value={amount}
        onChange={handleAmountChange}
        min={1}
        max={maxAllowedAmount}
        placeholder="e.g. 1.5"
        disabled={isBusy || !isCreatorWallet || lockingClosed || maxAllowedAmount <= 0}
      />

      <button
        onClick={fetchPrice}
        disabled={
          !amount ||
          isBusy ||
          maxAllowedAmount <= 0 ||
          !isCreatorWallet ||
          lockingClosed
        }
        className="w-full py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-purple-600 hover:bg-purple-700 text-white mt-2"
      >
        {loadingPrice ? 'Checking price…' : 'Check Price'}
      </button>

      {price !== '0' && (
        <>
          <div className="mt-2 text-sm text-gray-300 text-center">
            Total cost: <strong>{displayPrice} ETH</strong>
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
    </div>
  )
}



























