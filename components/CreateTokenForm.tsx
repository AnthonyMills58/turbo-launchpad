'use client'

import { useAccount, useWalletClient } from 'wagmi'
import { useState } from 'react'
import { Input, TextArea, Select } from '@/components/ui/FormInputs'
import { validateTokenForm, TokenForm } from '@/lib/validateTokenForm'
import TurboToken from '@/lib/abi/TurboToken.json'
import { ethers } from 'ethers'

export default function CreateTokenForm() {
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
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
    const value = e.target.type === 'number' ? Number(e.target.value) : e.target.value
    setForm({ ...form, [e.target.name]: value })
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!walletClient || !isConnected || !address) {
      alert('Wallet not connected')
      return
    }

    const validationError = validateTokenForm(form, proMode)
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      // 1. Deploy token contract
      const ethersProvider = new ethers.BrowserProvider(walletClient)
      const signer = await ethersProvider.getSigner()

      const factory = new ethers.ContractFactory(
        TurboToken.abi,
        TurboToken.bytecode,
        signer
      )

      const tokenName = form.name
      const tokenSymbol = form.name.slice(0, 4).toUpperCase()

      const raiseTarget = ethers.parseEther(form.raiseTarget.toString())
      const totalSupply = ethers.parseUnits(form.supply.toString(), 18) // assume 18 decimals

      // ✅ Poprawna kolejność argumentów!
      const contract = await factory.deploy(
        tokenName,       // name_
        tokenSymbol,     // symbol_
        raiseTarget,     // raiseTarget_
        address,         // creator_
        totalSupply      // maxSupply_
      )

      await contract.waitForDeployment()
      const contractAddress = await contract.getAddress()
      console.log('✅ Token deployed at:', contractAddress)

      // 2. Send metadata to backend
      const payload = {
        ...form,
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
        alert('✅ Token saved to DB!')
      } else {
        alert('❌ Backend error: ' + data.error)
      }
    } catch (err) {
      console.error(err)
      alert('❌ Failed to deploy token contract.')
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
        disabled={!isConnected}
        className="w-full bg-green-600 hover:bg-green-700 transition-all text-white py-2 text-sm rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isConnected ? 'Create Token' : 'Connect Wallet to Create'}
      </button>
    </form>
  )
}






