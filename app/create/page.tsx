'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'

export default function CreateTokenPage() {
  const { isConnected } = useAccount()

  const [proMode, setProMode] = useState(false)
  const [form, setForm] = useState({
    name: '',
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

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    setForm({ ...form, [e.target.name]: e.target.value })
    setError(null)
  }

  function isValidUrl(url: string) {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }

  function validate() {
    if (form.name.length < 3 || form.name.length > 32) {
      return 'Token name must be between 3 and 32 characters.'
    }
    if (!/^[a-zA-Z0-9\- ]+$/.test(form.name)) {
      return 'Token name can only include letters, numbers, spaces, and dashes.'
    }
    if (!form.description || form.description.length > 256) {
      return 'Description is required and must be under 256 characters.'
    }
    if (form.image && !isValidUrl(form.image)) {
      return 'Image URL must be a valid link.'
    }
    if (form.twitter && (!form.twitter.startsWith('https://') || !form.twitter.includes('twitter.com'))) {
      return 'Twitter link must start with https:// and contain twitter.com'
    }
    if (form.telegram && (!form.telegram.startsWith('https://') || !form.telegram.includes('t.me'))) {
      return 'Telegram link must start with https:// and contain t.me'
    }
    if (proMode && Number(form.supply) < 1000) {
      return 'Total supply must be at least 1,000.'
    }
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    const res = await fetch('/api/create-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    const data = await res.json()
    if (data.success) {
      alert('✅ Token saved!')
    } else {
      alert('❌ Error: ' + data.error)
    }
  }

  return (
    <div className="min-h-screen bg-[#0d0f1a] text-white flex justify-center items-start pt-8 px-2">
      <div className="w-full max-w-xl bg-[#151827] p-4 rounded-lg shadow-lg">

        {/* Wallet Connect Button */}
        <div className="flex justify-end mb-4">
          <ConnectButton />
        </div>

        <h1 className="text-2xl font-bold mb-4 text-center">Create Your Token</h1>

        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
          {error && <p className="text-red-500 text-sm font-medium">{error}</p>}

          <div>
            <label className="block text-gray-400 mb-1">Token Name</label>
            <input name="name" value={form.name} onChange={handleChange} placeholder="Token Name" className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded" />
          </div>

          <div>
            <label className="block text-gray-400 mb-1">Description</label>
            <textarea name="description" value={form.description} onChange={handleChange} placeholder="Describe your token" className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded" />
          </div>

          <div>
            <label className="block text-gray-400 mb-1">Image URL</label>
            <input name="image" value={form.image} onChange={handleChange} placeholder="Image URL" className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded" />
          </div>

          <div>
            <label className="block text-gray-400 mb-1">Twitter</label>
            <input name="twitter" value={form.twitter} onChange={handleChange} placeholder="Twitter link" className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded" />
          </div>

          <div>
            <label className="block text-gray-400 mb-1">Telegram</label>
            <input name="telegram" value={form.telegram} onChange={handleChange} placeholder="Telegram link" className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded" />
          </div>

          <div className="flex items-center space-x-2 pt-1">
            <input type="checkbox" checked={proMode} onChange={() => setProMode(!proMode)} className="accent-green-500" />
            <span className="text-gray-300">Enable Pro Mode</span>
          </div>

          {proMode && (
            <>
              <div>
                <label className="block text-gray-400 mb-1">Total Supply</label>
                <input
                  name="supply"
                  type="number"
                  value={form.supply}
                  onChange={handleChange}
                  placeholder="Total Supply"
                  className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded"
                />
              </div>

              <div>
                <label className="block text-gray-400 mb-1">Raise Target</label>
                <select
                  name="raiseTarget"
                  value={form.raiseTarget}
                  onChange={handleChange}
                  className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded"
                >
                  <option value={5}>5 ETH</option>
                  <option value={12}>12 ETH</option>
                  <option value={25}>25 ETH</option>
                </select>
              </div>

              <div>
                <label className="block text-gray-400 mb-1">Target DEX</label>
                <select
                  name="dex"
                  value={form.dex}
                  onChange={handleChange}
                  className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded"
                >
                  <option value="GTE">GTE</option>
                  <option value="Bronto">Bronto</option>
                </select>
              </div>

              <div>
                <label className="block text-gray-400 mb-1">Bonding Curve Model</label>
                <select
                  name="curveType"
                  value={form.curveType}
                  onChange={handleChange}
                  className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded"
                >
                  <option value="linear">Linear – Steady growth</option>
                  <option value="exponential">Exponential – Rapid growth</option>
                  <option value="sigmoid">Sigmoid – Balanced growth</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Controls how the price increases as users buy. Most creators choose linear.
                  ⚠️ For MVP, all tokens use linear pricing under the hood. Curve type is for visual and future customization only.
                </p>
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={!isConnected}
            className="w-full bg-green-600 hover:bg-green-700 transition-all text-white py-2 text-sm rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isConnected ? 'Create Token' : 'Connect Wallet to Create'}
          </button>
        </form>
      </div>
    </div>
  )
}




