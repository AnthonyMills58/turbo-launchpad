'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface HashDisplayProps {
  hash: string
  className?: string
  showCopyIcon?: boolean
}

export default function HashDisplay({ hash, className = '', showCopyIcon = true }: HashDisplayProps) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy: ', err)
    }
  }

  // Shorten hash: first 6 chars + ... + last 4 chars
  const shortenedHash = `${hash.slice(0, 6)}...${hash.slice(-4)}`

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="font-mono">{shortenedHash}</span>
      {showCopyIcon && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            copyToClipboard(hash)
          }}
          className="hover:text-white transition-colors"
          title="Copy full hash"
        >
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
        </button>
      )}
    </span>
  )
}
