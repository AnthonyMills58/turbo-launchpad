
'use client'

import { useAccount, useWalletClient } from 'wagmi'
import { useState } from 'react'
import { Input, TextArea, Select } from '@/components/ui/FormInputs'
import { validateTokenForm, TokenForm } from '@/lib/validateTokenForm'
import TurboToken from '@/lib/abi/TurboToken.json'
import { ethers } from 'ethers'
import { useRouter } from 'next/navigation'
import { useSync } from '@/lib/SyncContext'

export default function CreateTokenForm() {
  const { triggerSync } = useSync()
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const chainId = walletClient?.chain.id
  const [proMode, setProMode] = useState(false)
  const [form, setForm] = useState<TokenForm>({
    name: '',
    symbol: '',
    description: '',
    image: '',
    twitter: '',
    telegram: '',
    website: '',
    supply: 1_000_000_000,
    raiseTarget: 12,
    dex: 'GTE',
    curveType: 'linear',
  })
  const [error, setError] = useState<string | null>(null)
  const [imageValid, setImageValid] = useState<boolean | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const value = e.target.type === 'number' ? Number(e.target.value) : e.target.value
    setForm({ ...form, [e.target.name]: value })
    setError(null)
    if (e.target.name === 'image') {
      setImageValid(null)
    }
  }

  const validateImageURL = (url: string) => {
    return new Promise<boolean>((resolve) => {
      if (!url) return resolve(false)
      const img = new Image()
      img.onload = () => resolve(true)
      img.onerror = () => resolve(false)
      img.src = url
    })
  }

  const onImageBlur = async () => {
    const valid = await validateImageURL(form.image)
    setImageValid(valid)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!walletClient || !isConnected || !address) {
      alert('Wallet not connected')
      return
    }

    if (!imageValid) {
      alert('Please enter a valid image URL before submitting.')
      return
    }

    const validationError = validateTokenForm(form, proMode)
    if (validationError) {
      setError(validationError)
      return
    }

    setIsSubmitting(true)
    try {
      const ethersProvider = new ethers.BrowserProvider(walletClient)
      const signer = await ethersProvider.getSigner()

      const factory = new ethers.ContractFactory(
        TurboToken.abi,
        TurboToken.bytecode,
        signer
      )

      const tokenName = form.name
      const tokenSymbol = form.symbol.toUpperCase()
      const raiseTarget = ethers.parseEther(form.raiseTarget.toString())
      const totalSupply = ethers.parseUnits(form.supply.toString(), 18)
      const platformFeeRecipient = process.env.NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT as string

      const contract = await factory.deploy(
        tokenName,
        tokenSymbol,
        raiseTarget,
        address,
        totalSupply,
        platformFeeRecipient
      )

      await contract.waitForDeployment()
      const contractAddress = await contract.getAddress()

      const typedContract = new ethers.Contract(
        contract.target as string,
        TurboToken.abi,
        signer
      );

      try {
        await typedContract.tokenInfo();
      } catch (err) {
        console.error("❌ Failed to call tokenInfo():", err)
      }

      const payload = {
        ...form,
        symbol: tokenSymbol,
        creatorAddress: address,
        contractAddress,
        chainId, // ✅ pass chainId here
      }


      const res = await fetch('/api/create-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (data.success && data.tokenId) {
        try {
          const syncRes = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contractAddress,
              tokenId: data.tokenId,
              chainId,
            }),
          })
          triggerSync() // 🔁 frontendowy refresh TokenDetailsView
          if (!chainId) {
            console.warn('Missing chainId — skipping sync')
            return
          }

          const syncData = await syncRes.json()
          if (!syncData.success) {
            console.warn('⚠️ Sync failed:', syncData.error)
          }
        } catch (syncErr) {
          console.error('❌ Error during token sync:', syncErr)
        }

        router.push('/')
      } else {
        alert('❌ Backend error: ' + data.error)
      }
    } catch (err) {
      console.error(err)
      alert('❌ Failed to deploy token contract.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-sm max-w-3xl mx-auto">
      {error && <p className="text-red-500 text-sm font-medium">{error}</p>}

      <div className="flex space-x-2">
        <div className="flex-1">
          <Input label="Token Name" name="name" value={form.name} onChange={handleChange} />
        </div>
        <div className="w-[120px]">
          <Input label="Symbol" name="symbol" value={form.symbol} onChange={handleChange} />
        </div>
      </div>

      <div className="flex space-x-4 items-center">
        <div className="flex-grow">
          <Input
            label="Image URL"
            name="image"
            value={form.image}
            onChange={handleChange}
            onBlur={onImageBlur}
          />
          {imageValid === false && (
            <p className="text-red-500 text-xs mt-1">Invalid image URL or unable to load image.</p>
          )}
          {imageValid === true && (
            <p className="text-green-400 text-xs mt-1">Image URL is valid!</p>
          )}
        </div>

        {form.image && imageValid && (
          <div className="w-20 h-20 rounded-md border border-gray-600 bg-[#1b1e2b] flex items-center justify-center overflow-hidden">
            <img
              src={form.image}
              alt="Token Image Preview"
              className="max-w-full max-h-full object-contain"
              onError={() => setImageValid(false)}
              onLoad={() => setImageValid(true)}
            />
          </div>
        )}
      </div>

      <div className="flex items-center space-x-2 pt-1">
        <input
          type="checkbox"
          checked={proMode}
          onChange={() => setProMode(!proMode)}
          className="accent-green-500"
          id="proMode"
        />
        <label htmlFor="proMode" className="text-gray-300 cursor-pointer">Enable Pro Mode</label>
      </div>

      {proMode && (
        <>
          <div>
            <label className="block text-sm font-medium text-white mb-1">Total Supply</label>
            <div className="flex gap-2 mb-2">
              {[
                { label: '1M', value: 1_000_000 },
                { label: '10M', value: 10_000_000 },
                { label: '100M', value: 100_000_000 },
                { label: '200M', value: 200_000_000 },
                { label: '500M', value: 500_000_000 },
                { label: '1B', value: 1_000_000_000 },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setForm({ ...form, supply: option.value })}
                  className="px-2 py-1 bg-gray-700 text-white rounded hover:bg-gray-600 text-xs"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Input
              type="number"
              name="supply"
              value={form.supply}
              onChange={handleChange}
              placeholder="Enter total supply"
              label="Max Supply"
            />
          </div>

          <TextArea
            label="Description"
            name="description"
            value={form.description}
            onChange={handleChange}
          />

          <Input label="Social" name="twitter" value={form.twitter} onChange={handleChange} />
          <Input label="Community" name="telegram" value={form.telegram} onChange={handleChange} />
          <Input label="Website" name="website" value={form.website} onChange={handleChange} />

          <Select
            label="Raise Target"
            name="raiseTarget"
            value={form.raiseTarget}
            onChange={handleChange}
            options={[
              { label: '0.01 (test)', value: '0.01' },
              { label: '5', value: '5' },
              { label: '12', value: '12' },
              { label: '25', value: '25' },
            ]}
            suffix="ETH"
          />
          <Select
            label="Target DEX"
            name="dex"
            value={form.dex}
            onChange={handleChange}
            options={[
              { label: 'GTE', value: 'GTE' },
              { label: 'Bronto', value: 'Bronto' },
            ]}
          />
          <Select
            label="Bonding Curve Model"
            name="curveType"
            value={form.curveType}
            onChange={handleChange}
            options={[
              { label: 'linear', value: 'linear' },
              { label: 'exponential', value: 'exponential' },
              { label: 'sigmoid', value: 'sigmoid' },
            ]}
          />
          <p className="text-xs text-gray-500 mt-1">
            Controls how the price increases as users buy. Most creators choose linear.
            ⚠️ For MVP, all tokens use linear pricing under the hood.
          </p>
        </>
      )}

      <button
        type="submit"
        disabled={isSubmitting || !isConnected || !imageValid}
        className="w-full bg-green-600 hover:bg-green-700 transition-all text-white py-2 text-sm rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Creating...' : isConnected ? 'Create Token' : 'Connect Wallet to Create'}
      </button>
    </form>
  )

}











