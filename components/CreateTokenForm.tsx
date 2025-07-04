'use client'

import { useAccount, useWalletClient } from 'wagmi'
import { useState } from 'react'
import { Input, TextArea, Select } from '@/components/ui/FormInputs'
import { validateTokenForm, TokenForm } from '@/lib/validateTokenForm'
import TurboToken from '@/lib/abi/TurboToken.json'
import { ethers } from 'ethers'
import { useRouter } from 'next/navigation'

export default function CreateTokenForm() {
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [proMode, setProMode] = useState(false)
  const [form, setForm] = useState<TokenForm>({
    name: '',
    symbol: '',
    description: '',
    image: '',
    twitter: '',
    telegram: '',
    supply: 1_000_000_000,
    raiseTarget: 12,
    dex: 'GTE',
    curveType: 'linear',
  })
  const [error, setError] = useState<string | null>(null)
  const [imageValid, setImageValid] = useState<boolean | null>(null) // null = not validated yet

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    const value = e.target.type === 'number' ? Number(e.target.value) : e.target.value
    setForm({ ...form, [e.target.name]: value })
    setError(null)
    if (e.target.name === 'image') {
      setImageValid(null) // reset validation when user edits the URL
    }
  }

  // Validate image URL by trying to load it
  const validateImageURL = (url: string) => {
    return new Promise<boolean>((resolve) => {
      if (!url) return resolve(false)
      const img = new Image()
      img.onload = () => resolve(true)
      img.onerror = () => resolve(false)
      img.src = url
    })
  }

  // Validate on blur
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

      console.log("Deploying TurboToken with params:")
      console.log("Token Name:", tokenName)
      console.log("Token Symbol:", tokenSymbol)
      console.log("Raise Target (wei):", raiseTarget.toString())
      console.log("Total Supply (token units):", totalSupply.toString())
      console.log("Fee address: ",platformFeeRecipient)

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
      console.log('✅ Token deployed at:', contractAddress)

      const typedContract = new ethers.Contract(
        contract.target as string,
        TurboToken.abi,
        signer
      );

      // 🔍 NEW: Read tokenInfo() to verify contract state
      try {
        const tokenInfo = await typedContract.tokenInfo();
        console.log("📦 tokenInfo() result:", tokenInfo)
      } catch (err) {
        console.error("❌ Failed to call tokenInfo():", err)
      }

      const payload = {
        ...form,
        symbol: tokenSymbol,
        creatorAddress: address,
        contractAddress,
      }

      const res = await fetch('/api/create-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (data.success) {
        router.push('/')
      } else {
        alert('❌ Backend error: ' + data.error)
      }
    } catch (err) {
      console.error(err)
      alert('❌ Failed to deploy token contract.')
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

      <TextArea label="Description" name="description" value={form.description} onChange={handleChange} />

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

        {/* Preview box - only show if image is valid */}
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

      <Input label="Twitter" name="twitter" value={form.twitter} onChange={handleChange} />
      <Input label="Telegram" name="telegram" value={form.telegram} onChange={handleChange} />

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
          <Input
            type="number"
            label="Total Supply"
            name="supply"
            value={form.supply}
            onChange={handleChange}
          />
          <Select
            label="Raise Target"
            name="raiseTarget"
            value={form.raiseTarget}
            onChange={handleChange}
            options={[
              { label: '0.001 (test)', value: '0.001' }, // 🧪 Just for testing
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
        disabled={!isConnected || !imageValid}
        className="w-full bg-green-600 hover:bg-green-700 transition-all text-white py-2 text-sm rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isConnected ? 'Create Token' : 'Connect Wallet to Create'}
      </button>
    </form>
  )
}










