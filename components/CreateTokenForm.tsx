'use client'

import { useAccount } from 'wagmi'
import { useState } from 'react'
import { Input, TextArea, Select } from '@/components/ui/FormInputs'
import { validateTokenForm, TokenForm } from '@/lib/validateTokenForm'

export default function CreateTokenForm() {
  const { address, isConnected } = useAccount()
  const [proMode, setProMode] = useState(false)
  const [form, setForm] = useState<TokenForm>({
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

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    setForm({ ...form, [e.target.name]: e.target.value })
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const validationError = validateTokenForm(form, proMode)
    if (validationError) {
      setError(validationError)
      return
    }

    const payload = { ...form, creatorAddress: address }

    const res = await fetch('/api/create-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const data = await res.json()
    if (data.success) {
      alert('✅ Token saved!')
    } else {
      alert('❌ Error: ' + data.error)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-sm">
      {error && <p className="text-red-500 text-sm font-medium">{error}</p>}

      <Input label="Token Name" name="name" value={form.name} onChange={handleChange} />
      <TextArea label="Description" name="description" value={form.description} onChange={handleChange} />
      <Input label="Image URL" name="image" value={form.image} onChange={handleChange} />
      <Input label="Twitter" name="twitter" value={form.twitter} onChange={handleChange} />
      <Input label="Telegram" name="telegram" value={form.telegram} onChange={handleChange} />

      <div className="flex items-center space-x-2 pt-1">
        <input
          type="checkbox"
          checked={proMode}
          onChange={() => setProMode(!proMode)}
          className="accent-green-500"
        />
        <span className="text-gray-300">Enable Pro Mode</span>
      </div>

      {proMode && (
        <>
          <Input type="number" label="Total Supply" name="supply" value={form.supply} onChange={handleChange} />
          <Select label="Raise Target" name="raiseTarget" value={form.raiseTarget} onChange={handleChange} options={['5', '12', '25']} suffix="ETH" />
          <Select label="Target DEX" name="dex" value={form.dex} onChange={handleChange} options={['GTE', 'Bronto']} />
          <Select label="Bonding Curve Model" name="curveType" value={form.curveType} onChange={handleChange} options={['linear', 'exponential', 'sigmoid']} />
          <p className="text-xs text-gray-500 mt-1">
            Controls how the price increases as users buy. Most creators choose linear.
            ⚠️ For MVP, all tokens use linear pricing under the hood.
          </p>
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
  )
}


