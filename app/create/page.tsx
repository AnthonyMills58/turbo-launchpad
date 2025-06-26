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
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Create Your Token</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input name="name" value={form.name} onChange={handleChange} placeholder="Token Name" className="w-full p-2 border rounded" />
        <textarea name="description" value={form.description} onChange={handleChange} placeholder="Description" className="w-full p-2 border rounded" />
        <input name="image" value={form.image} onChange={handleChange} placeholder="Image URL" className="w-full p-2 border rounded" />
        <input name="twitter" value={form.twitter} onChange={handleChange} placeholder="Twitter link" className="w-full p-2 border rounded" />
        <input name="telegram" value={form.telegram} onChange={handleChange} placeholder="Telegram link" className="w-full p-2 border rounded" />

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={proMode} onChange={() => setProMode(!proMode)} />
          Enable Pro Mode
        </label>

        {proMode && (
          <>
            <input name="supply" type="number" value={form.supply} onChange={handleChange} placeholder="Total Supply" className="w-full p-2 border rounded" />
            
            <label>Raise Target</label>
            <select name="raiseTarget" value={form.raiseTarget} onChange={handleChange} className="w-full p-2 border rounded">
              <option value={5}>5 ETH</option>
              <option value={12}>12 ETH</option>
              <option value={25}>25 ETH</option>
            </select>

            <label>Target DEX</label>
            <select name="dex" value={form.dex} onChange={handleChange} className="w-full p-2 border rounded">
              <option value="GTE">GTE</option>
              <option value="Bronto">Bronto</option>
            </select>
          </>
        )}

        <button type="submit" className="w-full bg-black text-white py-2 rounded">Create Token</button>
      </form>
    </div>
  )
}
