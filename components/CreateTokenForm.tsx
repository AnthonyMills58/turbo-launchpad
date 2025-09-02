'use client'

import { useAccount, useWalletClient } from 'wagmi'
import { useState } from 'react'
import { Input, TextArea, Select } from '@/components/ui/FormInputs'
import LogoContainer from './LogoContainer'
import { validateTokenForm, TokenForm } from '@/lib/validateTokenForm'
import TurboToken from '@/lib/abi/TurboToken.json'
import { ethers } from 'ethers'
import { useRouter } from 'next/navigation'
import { useSync } from '@/lib/SyncContext'
import { DEX_ROUTER_BY_CHAIN } from '@/lib/dex'

export default function CreateTokenForm() {
  const { triggerSync } = useSync()
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const chainId = walletClient?.chain.id
  const [proMode, setProMode] = useState(false)

  // ✅ NEW: add minUnlockDays with default 2
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
    minUnlockDays: 2, // <— NEW (2–30 recommended)
  })

  // Media upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoAssetId, setLogoAssetId] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [imageValid, setImageValid] = useState<boolean | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Which fields should be coerced to numbers when changed via <input>/<select>
  const NUMERIC_FIELDS = new Set<keyof TokenForm>(['supply', 'raiseTarget', 'minUnlockDays'])

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    // Tell TS this name is one of your TokenForm keys
    const field = e.target.name as keyof TokenForm
    const raw = e.target.value

    let parsed: unknown = raw
    if (NUMERIC_FIELDS.has(field)) {
      parsed = Number(raw)
    }

    setForm(prev => ({
      ...prev,
      [field]: parsed as TokenForm[typeof field], // type-safe cast to the specific field type
    }))

    setError(null)
    if (field === 'image') {
      setImageValid(null)
      // Clear uploaded logo when user enters image URL
      if (raw.trim()) {
        setSelectedFile(null)
        setLogoPreview(null)
        setLogoAssetId(null)
      }
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

  // File validation helper
  const validateAndProcessFile = (file: File) => {
    // Validate file size (2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('File too large. Maximum size is 2MB.')
      return false
    }
    
    // Validate file type
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
      alert('Invalid file type. Please select PNG, JPEG, or WebP image.')
      return false
    }
    
    setSelectedFile(file)
    setLogoAssetId(null) // Reset asset ID when new file is selected
    
    // Clear image URL when user selects a file
    setForm(prev => ({ ...prev, image: '' }))
    setImageValid(null)
    
    // Create preview
    const previewUrl = URL.createObjectURL(file)
    setLogoPreview(previewUrl)
    return true
  }

  // File upload handlers
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      validateAndProcessFile(file)
    }
  }

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      const file = files[0]
      validateAndProcessFile(file)
    }
  }

  const uploadLogo = async (): Promise<string | null> => {
    if (!selectedFile || !address) return null
    
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('kind', 'token_logo')
      formData.append('ownerWallet', address)
      
      const response = await fetch('/api/media/upload', {
        method: 'POST',
        body: formData,
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Upload failed')
      }
      
      const result = await response.json()
      setLogoAssetId(result.assetId)
      // Clear the image URL since we now have a logo asset
      setForm(prev => ({ ...prev, image: '' }))
      setImageValid(null)
      return result.assetId
    } catch (error) {
      console.error('Logo upload error:', error)
      alert(`Logo upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return null
    } finally {
      setIsUploading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!walletClient || !isConnected || !address) {
      alert('Wallet not connected')
      return
    }

    // Upload logo if file is selected
    let finalLogoAssetId = logoAssetId
    if (selectedFile && !logoAssetId) {
      finalLogoAssetId = await uploadLogo()
      if (!finalLogoAssetId) {
        return // Upload failed, error already shown
      }
    }

    // If user has both image URL and logo asset, prioritize logo asset
    let finalImage = form.image
    if (finalLogoAssetId) {
      finalImage = '' // Clear image URL when logo asset is present
    }

    if (!imageValid && !finalLogoAssetId) {
      alert('Please provide either a valid image URL or upload a logo file before submitting.')
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

      // Resolve active chain id *now* (fallback to provider if walletClient undefined)
      const activeChainId =
        walletClient?.chain?.id ??
        Number((await signer.provider!.getNetwork()).chainId)

      const dexRouter = DEX_ROUTER_BY_CHAIN[activeChainId]
      if (!dexRouter) {
        alert(`Unsupported chainId ${activeChainId}`)
        setIsSubmitting(false)
        return
      }

      const factory = new ethers.ContractFactory(
        TurboToken.abi,
        TurboToken.bytecode,
        signer
      )

      const tokenName = form.name
      const tokenSymbol = form.symbol.toUpperCase()
      const raiseTarget = ethers.parseEther(String(form.raiseTarget))
      const totalSupply = ethers.parseUnits(String(form.supply), 18)
      const platformFeeRecipient = process.env
        .NEXT_PUBLIC_PLATFORM_FEE_RECIPIENT as string

      // ✅ NEW: get days for constructor + seconds for DB
      const minUnlockDays = Number(form.minUnlockDays || 2)
      const minTokenAgeForUnlockSeconds = minUnlockDays * 24 * 60 * 60

      const isMegaEthTestnet = chainId === 6342
      const deployOverrides = isMegaEthTestnet ? { gasLimit: 7_000_000n } : {}

      // ✅ NEW ARG ORDER: pass minUnlockDays (days) before overrides
      const contract = await factory.deploy(
        tokenName,
        tokenSymbol,
        raiseTarget,
        address,
        totalSupply,
        platformFeeRecipient,
        dexRouter,
        minUnlockDays, // <— NEW
        deployOverrides
      )

      await contract.waitForDeployment()
      const contractAddress = await contract.getAddress()

      const typedContract = new ethers.Contract(
        contract.target as string,
        TurboToken.abi,
        signer
      )
      try {
        await typedContract.tokenInfo()
      } catch (err) {
        console.error('❌ Failed to call tokenInfo():', err)
      }

      // ✅ include seconds in payload for DB
      const payload = {
        ...form,
        image: finalImage, // Use the prioritized image value
        minTokenAgeForUnlockSeconds, // <— NEW (seconds)
        symbol: tokenSymbol,
        creatorAddress: address,
        contractAddress,
        chainId,
        logoAssetId: finalLogoAssetId, // <— NEW: include logo asset ID
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
          triggerSync()
          if (!chainId) {
            console.warn('Missing chainId — skipping sync')
          } else {
            const syncData = await syncRes.json()
            if (!syncData.success) {
              console.warn('⚠️ Sync failed:', syncData.error)
            }
          }
        } catch (syncErr) {
          console.error('❌ Error during token sync:', syncErr)
        }

        // ✅ Redirect straight to TokenDetailsView as our “Step 2”
        // (Adjust the route if your token page path differs)
        try {
          const selectionKey = tokenSymbol; // you already set tokenSymbol = form.symbol.toUpperCase()
          router.push(`/?selected=${encodeURIComponent(selectionKey)}&new=1`)
        } catch {
          router.push('/') // fallback
        }
      } else {
        alert('❌ Backend error: ' + data.error)
      }
    } catch (err) {
      console.error('Deployment error:', err)
      const errorMsg = err instanceof Error ? err.message : String(err)
      if (errorMsg.toLowerCase().includes('gas')) {
        alert(
          '⚠️ Deployment failed due to gas estimation. Try again or check your ETH balance.'
        )
      } else {
        alert('❌ Failed to deploy token contract.')
      }
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

      <div className="space-y-4">
        {/* Logo Upload Section */}
        <div>
          <label className="block text-sm font-medium text-white mb-2">Token Logo</label>
          <div className="flex space-x-4 items-start">
                        <div className="flex-1">
              {/* Drag & Drop Zone */}
              <div
                className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-all duration-200 ${
                  isDragOver
                    ? 'border-blue-400 bg-blue-50 bg-opacity-10 scale-105'
                    : 'border-gray-600 hover:border-gray-500'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    document.getElementById('create-logo-upload')?.click()
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label="Drag and drop logo file here or click to browse"
              >
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  onChange={handleFileSelect}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  id="create-logo-upload"
                />
                
                {selectedFile ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-center space-x-2">
                      <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-green-400 font-medium">{selectedFile.name}</span>
                    </div>
                    <p className="text-xs text-gray-400">Click or drag to change file</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                      <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div>
                      <p className="text-sm text-gray-300 font-medium">
                        {isDragOver ? 'Drop your logo here' : 'Drag & drop your logo here'}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">or click to browse</p>
                    </div>
                    <p className="text-xs text-gray-500">
                      PNG, JPEG, or WebP. Maximum 2MB.
                    </p>
                  </div>
                )}
              </div>
              
              {isUploading && (
                <p className="text-blue-400 text-xs mt-1 text-center">Uploading logo...</p>
              )}
            </div>

            {/* Logo Preview */}
            {logoPreview && (
              <LogoContainer
                src={logoPreview}
                alt="Logo Preview"
                baseWidth={80}
                className="rounded-lg border border-gray-600 bg-[#1b1e2b]"
              />
            )}
          </div>
        </div>

        {/* Image URL Section (fallback) */}
        <div>
          <label className="block text-sm font-medium text-white mb-2">Or Image URL (fallback)</label>
          <div className="flex space-x-4 items-center">
            <div className="flex-grow">
              <Input
                label=""
                name="image"
                value={form.image}
                onChange={handleChange}
                onBlur={onImageBlur}
                placeholder="https://example.com/image.png"
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={form.image}
                  alt="Token Image Preview"
                  className="w-full h-full object-contain"
                  onError={() => setImageValid(false)}
                  onLoad={() => setImageValid(true)}
                />
              </div>
            )}
          </div>
        </div>
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
              { label: '0.001 (test)', value: '0.001' },
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
            options={[{ label: 'GTE', value: 'GTE' }]}
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

          {/* ✅ NEW: Min Token Age for Unlock (days) */}
          <Select
            label="Min Token Age for Creator Unlock"
            name="minUnlockDays"
            value={form.minUnlockDays}
            onChange={handleChange}
            options={[
              { label: '2 days (default)', value: '2' },
              { label: '3 days', value: '3' },
              { label: '5 days', value: '5' },
              { label: '7 days', value: '7' },
              { label: '14 days', value: '14' },
              { label: '30 days', value: '30' },
            ]}
            suffix="days"
          />
          <p className="text-xs text-gray-500">
            Creator can unlock locked tokens after this time if the token hasn’t graduated yet.
          </p>
        </>
      )}

      <button
        type="submit"
        disabled={isSubmitting || isUploading || !isConnected || (!imageValid && !selectedFile)}
        className="w-full bg-green-600 hover:bg-green-700 transition-all text-white py-2 text-sm rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Creating...' : isUploading ? 'Uploading...' : isConnected ? 'Create Token' : 'Connect Wallet to Create'}
      </button>
    </form>
  )
}












