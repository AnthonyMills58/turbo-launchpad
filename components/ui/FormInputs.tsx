import React from 'react'

// INPUT
export type InputProps = {
  label: string
  name: string
  value: string | number
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void
  type?: string
  placeholder?: string
  min?: number
  max?: number
  disabled?: boolean
  className?: string
  step?: number | string
  inputMode?: string
  pattern?: string
}

export function Input({ label, className, ...props }: InputProps) {
  return (
    <div className="mb-4">
      <label htmlFor={props.name} className="block text-gray-400 mb-1">{label}</label>
      <input
        {...props}
        className={`w-full p-2 text-sm bg-[#232633]/40 border border-[#2a2f45] rounded focus:outline-none focus:ring focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${className || ''}`}
      />
    </div>
  )
}

// TEXTAREA
export type TextAreaProps = {
  label: string
  name: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  rows?: number
  disabled?: boolean
}

export function TextArea({ label, rows = 3, ...props }: TextAreaProps) {
  return (
    <div className="mb-4">
      <label htmlFor={props.name} className="block text-gray-400 mb-1">{label}</label>
      <textarea
        rows={rows}
        {...props}
        className="w-full p-2 text-sm bg-[#232633]/40 border border-[#2a2f45] rounded focus:outline-none focus:ring focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  )
}

// SELECT
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
    <div className="mb-4">
      <label htmlFor={name} className="block text-gray-400 mb-1">{label}</label>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className="w-full p-2 text-sm bg-[#232633]/40 border border-[#2a2f45] rounded focus:outline-none focus:ring focus:border-blue-500"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-[#232633] text-white">
            {opt.label} {suffix}
          </option>
        ))}
      </select>
    </div>
  )
}



