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
  centerAlign?: boolean
}

export default function UserProfile({ wallet, showAvatar = true, showName = true, className = '', showCreatorLabel = false, showTime = false, createdTime, layout = 'default', centerAlign = false }: UserProfileProps) {
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
      <div className={`flex items-center space-x-2 ${centerAlign ? 'justify-center' : ''}`}>
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
           <div className={`flex flex-col ${centerAlign ? 'items-center text-center' : ''}`}>
             {layout === 'compact' ? (
               <>
                 {/* Line 1: Creator name */}
                 <div className="text-white hover:text-white transition-colors cursor-pointer flex items-center gap-1 text-sm">
                   <span className="text-gray-400">by</span>
                   {displayName && (
                     <span 
                       className="text-gray-400 truncate max-w-[80px]"
                       title={displayName}
                     >
                       {displayName}
                     </span>
                   )}
                 </div>
                 {/* Line 2: Address with copy icon */}
                 <div className={`flex items-center gap-2 text-xs text-gray-400 ${centerAlign ? 'justify-center' : ''}`}>
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
         <div className="absolute z-[9999] top-full right-0 transform translate-x-0 mt-2 px-3 py-2 bg-[#1b1e2b] border-2 border-purple-400/30 rounded-xl shadow-2xl shadow-purple-500/20 text-white text-xs min-w-52 max-w-80 w-fit transition-all duration-200 ease-in-out opacity-100">
           <div className="flex justify-center mb-2">
             {hasAvatar && profile ? (
               <div className="w-16 h-16 rounded-full overflow-hidden flex-shrink-0 bg-gray-700 ring-2 ring-purple-400/20 shadow-lg">
                 <img
                   src={`/api/media/${profile.avatar_asset_id}?v=thumb`}
                   alt={profile.display_name || 'User'}
                   className="w-full h-full object-cover object-center"
                 />
               </div>
             ) : (
               <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-xl text-white shadow-lg ring-2 ring-purple-400/20">
                 {wallet[0].toUpperCase()}
               </div>
             )}
           </div>
           {displayName && (
             <div className="text-white text-xs font-bold text-center mb-2 bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
               {displayName}
             </div>
           )}
           {profile?.bio && (
             <div className="text-gray-300 text-xs break-words text-center leading-tight">
               {profile.bio.length > 80 
                 ? `${profile.bio.substring(0, 80)}...` 
                 : profile.bio}
             </div>
           )}
           {/* Arrow */}
           <div className="absolute top-0 right-4 transform translate-x-0 -translate-y-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-[#1b1e2b]"></div>
         </div>
       )}
    </div>
  )
}
