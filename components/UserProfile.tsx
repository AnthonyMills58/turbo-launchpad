'use client'

import { useState, useEffect, useCallback } from 'react'
import LogoContainer from './LogoContainer'

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
}

export default function UserProfile({ wallet, showAvatar = true, showName = true, className = '', showCreatorLabel = false }: UserProfileProps) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showTooltip, setShowTooltip] = useState(false)
  
  console.log('🔍 UserProfile component rendered with wallet:', wallet, 'showAvatar:', showAvatar, 'showName:', showName)

  const loadProfile = useCallback(async () => {
    try {
      console.log('🔍 Loading profile for wallet:', wallet)
      const response = await fetch(`/api/profile?wallet=${wallet}`)
      console.log('🔍 Profile response status:', response.status)
      
      if (response.ok) {
        const data = await response.json()
        console.log('🔍 Profile data:', data)
        if (data.success) {
          setProfile(data.profile)
          
          // Test if media endpoint works
          if (data.profile?.avatar_asset_id) {
            console.log('🔍 Testing media endpoint for avatar:', data.profile.avatar_asset_id)
            try {
              const mediaResponse = await fetch(`/api/media/${data.profile.avatar_asset_id}?v=thumb`)
              console.log('🔍 Media response status:', mediaResponse.status)
            } catch (mediaError) {
              console.error('🔍 Media endpoint error:', mediaError)
            }
          }
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

  const displayName = profile?.display_name || wallet.slice(0, 6) + '...' + wallet.slice(-4)
  const hasAvatar = profile?.avatar_asset_id

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

  // If no profile data and not loading, show empty div (will be hidden by parent)
  if (!profile && !isLoading) {
    return <div className="hidden" />
  }

  return (
    <div 
      className={`relative inline-block ${className}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex items-center space-x-2">
        {showCreatorLabel && (
          <span className="text-xs text-gray-400">Creator:</span>
        )}
                 {showAvatar && (
                      hasAvatar ? (
             <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 bg-gray-700">
               <img
                 src={`/api/media/${profile!.avatar_asset_id}?v=thumb`}
                 alt={displayName}
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
             <span className="text-sm text-gray-300 hover:text-white transition-colors cursor-pointer">
               {displayName}
             </span>
             <span className="text-xs text-gray-400">
               {wallet.slice(0, 6)}...{wallet.slice(-4)}
             </span>
           </div>
         )}
      </div>

             {/* Tooltip */}
       {showTooltip && profile && (
         <div className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-[#1e1f25] border border-[#2a2d3a] rounded-lg shadow-lg text-white text-sm whitespace-nowrap min-w-64">
           <div className="flex items-center space-x-3 mb-2">
             {hasAvatar ? (
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
                 {profile.display_name || 'Anonymous'}
               </div>
               <div className="text-xs text-gray-400">
                 {wallet.slice(0, 6)}...{wallet.slice(-4)}
               </div>
             </div>
           </div>
           {profile.bio && (
             <div className="text-gray-300 text-xs max-w-xs break-words">
               {profile.bio}
             </div>
           )}
           {/* Arrow */}
           <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-[#1e1f25]"></div>
         </div>
       )}
    </div>
  )
}
