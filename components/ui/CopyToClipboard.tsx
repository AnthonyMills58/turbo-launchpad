'use client'

import { useState } from 'react'

export default function CopyToClipboard({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center space-x-1 text-gray-400 hover:text-white transition"
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
      type="button"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="w-4 h-4"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.25 6.75h12M8.25 12h12M8.25 17.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3 12h.007v.008H3V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3 17.25h.007v.008H3v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
        />
      </svg>
      {copied && <span className="text-green-400 text-xs ml-1">Copied!</span>}
    </button>
  )
}

