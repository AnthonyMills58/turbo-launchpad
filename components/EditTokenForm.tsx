'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Token } from '@/types/token'
import { Input, TextArea } from '@/components/ui/FormInputs'

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

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const handleSubmit = async () => {
    setIsSaving(true)
    setError(null)

    if (!imageValid) {
      setError('Please enter a valid image URL before saving.')
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
          image,
          description,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.message || 'Failed to save changes')
      }

      if (onSuccess) onSuccess()
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

      <TextArea
        label="Token Description"
        name="description"
        rows={4}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Enter a short description of your token..."
        disabled={isSaving}
      />

      <div className="mb-4">
        <Input
          label="Image URL"
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
              <p className="text-green-400 text-xs">✅ Image looks good</p>
            )}
            <div className="w-16 h-16 border border-gray-500 rounded bg-black flex items-center justify-center overflow-hidden">
              {imageValid && (
                <img
                  src={image}
                  alt="Preview"
                  className="object-contain w-full h-full"
                />
              )}
            </div>
          </div>
        )}
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
          disabled={isSaving}
          className={`px-4 py-2 rounded-md text-white text-sm font-semibold transition ${
            isSaving
              ? 'bg-neutral-700 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}


