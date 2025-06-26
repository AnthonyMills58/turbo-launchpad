'use client'

import { useState } from 'react'

export default function CreateTokenPage() {
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
  })

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    console.log('Token config:', form)
  }

  return (
    <div className="min-h-screen bg-[#0d0f1a] text-white flex justify-center items-start pt-8 px-2">
      <div className="w-full max-w-xl bg-[#151827] p-4 rounded-lg shadow-lg">
        <h1 className="text-2xl font-bold mb-4 text-center">Create Your Token</h1>

        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
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
                <input name="supply" type="number" value={form.supply} onChange={handleChange} placeholder="Total Supply" className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded" />
              </div>

              <div>
                <label className="block text-gray-400 mb-1">Raise Target</label>
                <select name="raiseTarget" value={form.raiseTarget} onChange={handleChange} className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded">
                  <option value={5}>5 ETH</option>
                  <option value={12}>12 ETH</option>
                  <option value={25}>25 ETH</option>
                </select>
              </div>

              <div>
                <label className="block text-gray-400 mb-1">Target DEX</label>
                <select name="dex" value={form.dex} onChange={handleChange} className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded">
                  <option value="GTE">GTE</option>
                  <option value="Bronto">Bronto</option>
                </select>
              </div>
            </>
          )}

          <button type="submit" className="w-full bg-green-600 hover:bg-green-700 transition-all text-white py-2 text-sm rounded-lg font-semibold">
            Create Token
          </button>
        </form>
      </div>
    </div>
  )
}

