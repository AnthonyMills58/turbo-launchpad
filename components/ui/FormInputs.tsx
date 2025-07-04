import React from 'react'

export type InputProps = {
  label: string
  name: string
  value: string | number
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void
  type?: string
  placeholder?: string
  min?: number   // <-- dodane
  max?: number   // <-- dodane
}

export function Input({ label, ...props }: InputProps) {
  return (
    <div>
      <label className="block text-gray-400 mb-1">{label}</label>
      <input
        {...props}
        className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded"
      />
    </div>
  )
}


export type TextAreaProps = {
  label: string
  name: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
}

export function TextArea({ label, ...props }: TextAreaProps) {
  return (
    <div>
      <label className="block text-gray-400 mb-1">{label}</label>
      <textarea
        {...props}
        className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded"
      />
    </div>
  )
}

export type SelectOption = {
  label: string
  value: string
}

export type SelectProps = {
  label: string
  name: string
  value: string | number
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  options: SelectOption[]
  suffix?: string
}

export function Select({ label, name, value, onChange, options, suffix = '' }: SelectProps) {
  return (
    <div>
      <label className="block text-gray-400 mb-1">{label}</label>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className="w-full p-2 text-sm bg-[#1e2132] border border-[#2a2f45] rounded"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label} {suffix}
          </option>
        ))}
      </select>
    </div>
  )
}


