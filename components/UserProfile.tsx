'use client'

import { useState, useEffect, useCallback } from 'react'
import { Copy } from 'lucide-react'

type Profile = {
  wallet: string
  display_name: string | null
  bio: string | null
  avatar_asset_id: string | null
}

type UserProfileProps = {
  wallet: string
  showAvatar?: boolean
  showName?: boolean
  className?: string
  showCreatorLabel?: boolean
  showTime?: boolean
  createdTime?: string
  layout?: 'default' | 'compact'
}

export default function UserProfile({ wallet, showAvatar = true, showName = true, className = '', showCreatorLabel = false, showTime = false, createdTime, layout = 'default' }: UserProfileProps) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showTooltip, setShowTooltip] = useState(false)
  const [copied, setCopied] = useState(false)
  

  const loadProfile = useCallback(async () => {
    try {
      const response = await fetch(`/api/profile?wallet=${wallet}`)
      
      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setProfile(data.profile)
          
        }
      } else {
        console.error('🔍 Profile API error:', response.status, response.statusText)
      }
    } catch (error) {
      console.error('🔍 Failed to load profile:', error)
    } finally {
      setIsLoading(false)
    }
  }, [wallet])

  useEffect(() => {
    if (wallet) {
      loadProfile()
    }
  }, [wallet, loadProfile])

  const displayName = profile?.display_name || undefined
  const hasAvatar = profile?.avatar_asset_id

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      console.log('Copied to clipboard:', text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy: ', err)
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = text
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (isLoading) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        {showAvatar && (
          <div className="w-6 h-6 bg-gray-600 rounded-full animate-pulse" />
        )}
        {showName && (
          <span className="text-sm text-gray-400 animate-pulse">Loading...</span>
        )}
      </div>
    )
  }

  // If no profile data and not loading, we'll show fallback content below

  return (
    <div 
      className={`relative inline-block ${className}`}
      onMouseEnter={() => profile && setShowTooltip(true)}
      onMouseLeave={() => profile && setShowTooltip(false)}
    >
      <div className="flex items-center space-x-2">
        {showCreatorLabel && (
          <span className="text-xs text-gray-400">Creator:</span>
        )}
                 {showAvatar && (
                      hasAvatar && profile ? (
             <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 bg-gray-700">
               <img
                 src={`/api/media/${profile.avatar_asset_id}?v=thumb`}
                 alt={displayName ?? 'User'}
                 className="w-full h-full object-cover object-center"
                 onError={() => {
                   // Fallback to placeholder if avatar fails to load
                 }}
               />
             </div>
           ) : (
             <div className="w-12 h-12 bg-gray-600 rounded-full flex items-center justify-center text-sm text-gray-300">
               {wallet[0].toUpperCase()}
             </div>
           )
        )}
                 {showName && (
           <div className="flex flex-col">
             {layout === 'compact' ? (
               <>
                 {/* Line 1: Creator name */}
                 <span className="text-white hover:text-white transition-colors cursor-pointer">
                   <span className="text-gray-400">by </span>
                   {displayName && <span className="font-semibold">{displayName}</span>}
                 </span>
                 {/* Line 2: Address with copy icon */}
                 <div className="flex items-center gap-2 text-xs text-gray-400">
                   <span className="font-mono">{wallet.slice(0, 6)}...{wallet.slice(-4)}</span>
                   <button
                     onClick={(e) => {
                       e.stopPropagation()
                       copyToClipboard(wallet)
                     }}
                     className="hover:text-white transition-colors"
                     title="Copy wallet address"
                   >
                     <Copy size={12} />
                   </button>
                   {copied && <span className="text-green-400 text-xs">Copied!</span>}
                 </div>
                 {/* Line 3: Time */}
                 {createdTime && (
                   <span className="text-sm text-gray-400">
                     {createdTime}
                   </span>
                 )}
               </>
             ) : (
               <>
                 <span className="text-sm text-gray-300 hover:text-white transition-colors cursor-pointer">
                   {displayName || 'by '}
                 </span>
                 {showTime ? (
                   <div className="flex items-center gap-2 text-xs text-gray-400">
                     <span>{wallet.slice(0, 6)}...{wallet.slice(-4)}</span>
                     <button
                       onClick={(e) => {
                         e.stopPropagation()
                         copyToClipboard(wallet)
                       }}
                       className="hover:text-white transition-colors"
                       title="Copy wallet address"
                     >
                       <Copy size={12} />
                     </button>
                     {createdTime && <span>• {createdTime}</span>}
                   </div>
                 ) : (
                   <span className="text-xs text-gray-400">
                     {wallet.slice(0, 6)}...{wallet.slice(-4)}
                   </span>
                 )}
               </>
             )}
           </div>
         )}
      </div>

             {/* Tooltip */}
       {showTooltip && profile && (
         <div className="absolute z-50 top-full left-1/2 transform -translate-x-1/2 mt-2 px-3 py-2 bg-[#1e1f25] border border-[#2a2d3a] rounded-lg shadow-lg text-white text-sm whitespace-nowrap min-w-64">
           <div className="flex items-center space-x-3 mb-2">
             {hasAvatar && profile ? (
               <div className="w-24 h-24 rounded-full overflow-hidden flex-shrink-0 bg-gray-700">
                 <img
                   src={`/api/media/${profile.avatar_asset_id}?v=thumb`}
                   alt={profile.display_name || 'User'}
                   className="w-full h-full object-cover object-center"
                 />
               </div>
             ) : (
               <div className="w-24 h-24 bg-gray-600 rounded-full flex items-center justify-center text-2xl text-gray-300">
                 {wallet[0].toUpperCase()}
               </div>
             )}
             <div className="flex-1">
               <div className="font-semibold text-white">
                 {profile?.display_name || 'Anonymous'}
               </div>
               <div className="text-xs text-gray-400">
                 {wallet.slice(0, 6)}...{wallet.slice(-4)}
               </div>
             </div>
           </div>
           {profile?.bio && (
             <div className="text-gray-300 text-xs max-w-xs break-words">
               {profile.bio}
             </div>
           )}
           {/* Arrow */}
           <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-[#1e1f25]"></div>
         </div>
       )}
    </div>
  )
}
