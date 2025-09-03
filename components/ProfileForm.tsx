'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { Input, TextArea } from '@/components/ui/FormInputs'
import LogoContainer from './LogoContainer'

type ProfileFormData = {
  displayName: string
  bio: string
}

export default function ProfileForm() {
  const { address } = useAccount()
  
  const [form, setForm] = useState<ProfileFormData>({
    displayName: '',
    bio: ''
  })
  
  // Media upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarAssetId, setAvatarAssetId] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [currentAvatarUrl, setCurrentAvatarUrl] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isRemovingAvatar, setIsRemovingAvatar] = useState(false)

  const loadProfile = useCallback(async () => {
    if (!address) return
    
    try {
      const response = await fetch(`/api/profile?wallet=${address}`)
      if (response.ok) {
        const profile = await response.json()
        if (profile.success && profile.profile) {
          setForm({
            displayName: profile.profile.display_name || '',
            bio: profile.profile.bio || ''
          })
          if (profile.profile.avatar_asset_id) {
            setAvatarAssetId(profile.profile.avatar_asset_id)
            setCurrentAvatarUrl(`/api/media/${profile.profile.avatar_asset_id}?v=thumb`)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load profile:', error)
    }
  }, [address])

  // Load existing profile data
  useEffect(() => {
    if (address) {
      loadProfile()
    }
  }, [address, loadProfile])

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
    setAvatarAssetId(null) // Reset asset ID when new file is selected
    
    // Create preview
    const previewUrl = URL.createObjectURL(file)
    setAvatarPreview(previewUrl)
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

  const uploadAvatar = async (): Promise<string | null> => {
    if (!selectedFile || !address) return null
    
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('kind', 'avatar')
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
      setAvatarAssetId(result.assetId)
      setCurrentAvatarUrl(`/api/media/${result.assetId}?v=thumb`)
      return result.assetId
    } catch (error) {
      console.error('Avatar upload error:', error)
      alert(`Avatar upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return null
    } finally {
      setIsUploading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    setIsSaving(true)
    setError(null)
    setSuccess(false)

    // Upload avatar if file is selected
    let finalAvatarAssetId = avatarAssetId
    if (selectedFile) {
      finalAvatarAssetId = await uploadAvatar()
      if (!finalAvatarAssetId) {
        setIsSaving(false)
        return // Upload failed, error already shown
      }
    }

    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: address,
          displayName: form.displayName,
          bio: form.bio,
          avatarAssetId: finalAvatarAssetId,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.message || 'Failed to save profile')
      }

      setSuccess(true)
      setError(null)
      
      // Clear form state
      setSelectedFile(null)
      setAvatarPreview(null)
      
      // Reload profile to get updated data
      await loadProfile()
    } catch (err) {
      console.error('Failed to save profile:', err)
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsSaving(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const removeAvatar = async () => {
    if (!address || !avatarAssetId) return
    
    setIsRemovingAvatar(true)
    try {
      // Update profile to remove avatar_asset_id
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wallet: address,
          displayName: form.displayName,
          bio: form.bio,
          avatarAssetId: null // Set to null to remove avatar
        }),
      })

      if (response.ok) {
        // Clear avatar state
        setAvatarAssetId(null)
        setCurrentAvatarUrl(null)
        setAvatarPreview(null)
        setSelectedFile(null)
        setSuccess(true)
        setTimeout(() => setSuccess(false), 3000)
      } else {
        setError('Failed to remove avatar')
      }
    } catch (error) {
      console.error('Failed to remove avatar:', error)
      setError('Failed to remove avatar')
    } finally {
      setIsRemovingAvatar(false)
    }
  }

  if (!address) {
    return (
      <div className="bg-[#1e1f25] p-6 rounded-lg border border-[#2a2d3a] w-full max-w-xl">
        <p className="text-center text-lg text-white">
          🔒 Please connect your wallet to edit your profile.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-[#1e1f25] p-6 rounded-lg border border-[#2a2d3a] w-full max-w-xl">
      <h2 className="text-lg font-bold text-white mb-4">Your Profile</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Display Name"
          name="displayName"
          type="text"
          value={form.displayName}
          onChange={handleChange}
          placeholder="Enter your display name"
          disabled={isSaving}
        />

        <TextArea
          label="Bio"
          name="bio"
          rows={4}
          value={form.bio}
          onChange={handleChange}
          placeholder="Tell us about yourself..."
          disabled={isSaving}
        />

        {/* Avatar Upload Section */}
        <div>
          <label className="block text-sm font-medium text-white mb-2">Profile Avatar</label>
          
          {/* Current Avatar Display */}
          {currentAvatarUrl && !selectedFile && (
            <div className="mb-3 p-3 bg-[#2a2d3a] rounded-md border border-[#3a3d4a]">
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-300">
                  <p>Avatar is currently set</p>
                  <p className="text-gray-400">Upload a new file to replace it</p>
                </div>
                <button
                  type="button"
                  onClick={removeAvatar}
                  disabled={isRemovingAvatar}
                  className={`px-3 py-1 rounded text-xs font-medium transition ${
                    isRemovingAvatar
                      ? 'bg-red-700 text-gray-400 cursor-not-allowed'
                      : 'bg-red-600 hover:bg-red-700 text-white'
                  }`}
                >
                  {isRemovingAvatar ? 'Removing...' : 'Remove Avatar'}
                </button>
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
                    document.getElementById('avatar-upload')?.click()
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label="Drag and drop avatar file here or click to browse"
              >
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  onChange={handleFileSelect}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  id="avatar-upload"
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
                        {isDragOver ? 'Drop your avatar here' : 'Drag & drop your avatar here'}
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
                <p className="text-blue-400 text-xs mt-1 text-center">Uploading avatar...</p>
              )}
            </div>

            {/* Current Avatar or Preview */}
            {avatarPreview ? (
              <LogoContainer
                src={avatarPreview}
                alt="Avatar Preview"
                baseWidth={96}
                className="rounded-lg border border-gray-600 bg-[#1b1e2b]"
              />
            ) : currentAvatarUrl ? (
              <LogoContainer
                src={currentAvatarUrl}
                alt="Current Avatar"
                baseWidth={96}
                className="rounded-lg border border-gray-600 bg-[#1b1e2b]"
                onError={() => setCurrentAvatarUrl(null)}
              />
            ) : (
              <div className="w-24 h-16 rounded-lg border border-gray-600 bg-[#1b1e2b] flex items-center justify-center text-gray-400 text-xs">
                No avatar
              </div>
            )}
          </div>
        </div>

        {error && <div className="text-red-400 text-sm">{error}</div>}
        {success && <div className="text-green-400 text-sm">✅ Profile saved successfully!</div>}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving || isUploading}
            className={`px-4 py-2 rounded-md text-white text-sm font-semibold transition ${
              isSaving || isUploading
                ? 'bg-neutral-700 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isSaving ? 'Saving...' : isUploading ? 'Uploading...' : 'Save Profile'}
          </button>
        </div>
      </form>
    </div>
  )
}
