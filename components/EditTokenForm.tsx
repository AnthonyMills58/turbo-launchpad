'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Token } from '@/types/token'
import { Input, TextArea } from '@/components/ui/FormInputs'
import { useAccount } from 'wagmi'
import LogoContainer from './LogoContainer'

type Props = {
  token: Token
  onCancel: () => void
  onSuccess?: () => void
}

export default function EditTokenForm({ token, onCancel, onSuccess }: Props) {
  const router = useRouter()

  const [website, setWebsite] = useState(token.website || '')
  const [twitter, setTwitter] = useState(token.twitter || '')
  const [telegram, setTelegram] = useState(token.telegram || '')
  const [dexName, setDexName] = useState(token.dex || '')
  const [description, setDescription] = useState(token.description || '')
  const [image, setImage] = useState(token.image || '')
  const [imageValid, setImageValid] = useState<boolean | null>(null)

  // Media upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoAssetId, setLogoAssetId] = useState<string | null>(token.token_logo_asset_id || null)
  const [isUploading, setIsUploading] = useState(false)
  const [currentLogoUrl, setCurrentLogoUrl] = useState<string | null>(token.token_logo_asset_id ? `/api/media/${token.token_logo_asset_id}?v=thumb` : null)
  const [isDragOver, setIsDragOver] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const on_dex = token.on_dex
  const { address } = useAccount()

  useEffect(() => {
    if (!image) {
      setImageValid(null)
      return
    }
    const img = new Image()
    img.onload = () => setImageValid(true)
    img.onerror = () => setImageValid(false)
    img.src = image
  }, [image])

  // Clear uploaded logo when image URL changes
  useEffect(() => {
    if (image && image.trim()) {
      setSelectedFile(null)
      setLogoPreview(null)
      setLogoAssetId(null)
      setCurrentLogoUrl(null)
    }
  }, [image])

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
    setImage('')
    setImageValid(null)
    setCurrentLogoUrl(null)
    
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
       // Update current logo URL and clear the image URL since we now have a logo asset
       setCurrentLogoUrl(`/api/media/${result.assetId}?v=thumb`)
       setImage('')
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

  const handleSubmit = async () => {
    console.log('🔍 handleSubmit: Starting...')
    console.log('🔍 handleSubmit: selectedFile:', selectedFile?.name)
    console.log('🔍 handleSubmit: logoAssetId:', logoAssetId)
    
    setIsSaving(true)
    setError(null)

    // Upload logo if file is selected (even if we already have one)
    let finalLogoAssetId = logoAssetId
    if (selectedFile) {
      console.log('🔍 handleSubmit: Calling uploadLogo...')
      finalLogoAssetId = await uploadLogo()
      console.log('🔍 handleSubmit: uploadLogo result:', finalLogoAssetId)
      if (!finalLogoAssetId) {
        return // Upload failed, error already shown
      }
    }

    // If user has both image URL and logo asset, prioritize logo asset
    let finalImage = image
    if (finalLogoAssetId) {
      finalImage = '' // Clear image URL when logo asset is present
    }

    if (!imageValid && !finalLogoAssetId) {
      setError('Please provide either a valid image URL or upload a logo file before saving.')
      setIsSaving(false)
      return
    }

    try {
      const res = await fetch('/api/edit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenId: token.id,
          website,
          twitter,
          telegram,
          dex: dexName,
          image: finalImage, // Use the prioritized image value
          description,
          logoAssetId: finalLogoAssetId,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.message || 'Failed to save changes')
      }

             if (onSuccess) onSuccess()
       // Update current logo URL if we have a new logo asset
       if (finalLogoAssetId) {
         setCurrentLogoUrl(`/api/media/${finalLogoAssetId}?v=thumb`)
       }
       router.refresh()
    } catch (err) {
      console.error('❌ Failed to save token edits:', err)
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="bg-[#1e1f25] p-6 rounded-lg border border-[#2a2d3a] w-full max-w-xl">
      <h2 className="text-lg font-bold text-white mb-4">Edit Token Info</h2>

      <Input
        label="Website"
        name="website"
        type="text"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        placeholder="https://example.com"
        disabled={isSaving}
      />

      <Input
        label="Social"
        name="twitter"
        type="text"
        value={twitter}
        onChange={(e) => setTwitter(e.target.value)}
        placeholder="https://twitter.com/yourtoken"
        disabled={isSaving}
      />

      <Input
        label="Community"
        name="telegram"
        type="text"
        value={telegram}
        onChange={(e) => setTelegram(e.target.value)}
        placeholder="https://t.me/yourcommunity"
        disabled={isSaving}
      />

      {!on_dex && (
      <div className="mb-4">
        <label className="block text-sm font-medium text-white mb-1">DEX Name</label>
        <select
          value={dexName}
          onChange={(e) => setDexName(e.target.value)}
          disabled={isSaving}
          className="w-full rounded-md bg-[#2c2f3a] text-white p-2 text-sm border border-[#3a3d4a] focus:outline-none focus:ring focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="Bronto">Bronto</option>
          <option value="GTE">GTE</option>
        </select>
      </div>
      )}

      <TextArea
        label="Token Description"
        name="description"
        rows={4}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Enter a short description of your token..."
        disabled={isSaving}
      />

      <div className="space-y-4">
                 {/* Logo Upload Section */}
         <div>
           <label className="block text-sm font-medium text-white mb-2">Token Logo</label>
           
           {/* Current Logo Display */}
           {currentLogoUrl && !selectedFile && (
             <div className="mb-3 p-3 bg-[#2a2d3a] rounded-md border border-[#3a3d4a]">
               <p className="text-xs text-gray-400 mb-2">Current logo:</p>
               <div className="flex items-center space-x-3">
                                    <LogoContainer
                     src={currentLogoUrl}
                     alt="Current Logo"
                     baseWidth={96}
                     className="rounded-lg border border-gray-600 bg-[#1b1e2b]"
                     onError={() => setCurrentLogoUrl(null)}
                   />
                 <div className="text-xs text-gray-300">
                   <p>Logo is currently set</p>
                   <p className="text-gray-400">Upload a new file to replace it</p>
                 </div>
               </div>
             </div>
           )}
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
                      document.getElementById('logo-upload')?.click()
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
                    id="logo-upload"
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

                           {/* Current Logo or Preview */}
                             {logoPreview ? (
                 <LogoContainer
                  src={logoPreview}
                  alt="Logo Preview"
                  baseWidth={96}
                  className="rounded-lg border border-gray-600 bg-[#1b1e2b]"
                />
                             ) : currentLogoUrl ? (
                 <LogoContainer
                  src={currentLogoUrl}
                  alt="Current Logo"
                  baseWidth={96}
                  className="rounded-lg border border-gray-600 bg-[#1b1e2b]"
                  onError={() => setCurrentLogoUrl(null)}
                />
                               ) : (
                  <div className="w-24 h-16 rounded-lg border border-gray-600 bg-[#1b1e2b] flex items-center justify-center text-gray-400 text-xs">
                    No logo selected
                  </div>
                )}
           </div>
         </div>

        {/* Image URL Section (fallback) */}
        <div>
          <label className="block text-sm font-medium text-white mb-2">Or Image URL (fallback)</label>
          <Input
            label=""
            name="image"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="https://cdn.example.com/image.png"
            disabled={isSaving}
          />
          {image && (
            <div className="flex items-center mt-2 space-x-3">
              {imageValid === false && (
                <p className="text-red-500 text-xs">❌ Invalid image URL</p>
              )}
              {imageValid === true && (
                <p className="text-red-400 text-xs">✅ Image looks good</p>
              )}
                                 <div className="w-16 h-16 border border-gray-500 rounded bg-black flex items-center justify-center overflow-hidden">
                     {imageValid && (
                       <>
                         {/* eslint-disable-next-line @next/next/no-img-element */}
                         <img
                           src={image}
                           alt="Preview"
                           className="w-full h-full object-contain"
                         />
                       </>
                     )}
                   </div>
            </div>
          )}
        </div>
      </div>

      {error && <div className="text-red-400 text-sm mb-2">{error}</div>}

      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={isSaving}
          className="px-4 py-2 rounded-md bg-gray-600 text-white text-sm hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={isSaving || isUploading}
          className={`px-4 py-2 rounded-md text-white text-sm font-semibold transition ${
            isSaving || isUploading
              ? 'bg-neutral-700 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {isSaving ? 'Saving...' : isUploading ? 'Uploading...' : 'Save'}
        </button>
      </div>
    </div>
  )
}


