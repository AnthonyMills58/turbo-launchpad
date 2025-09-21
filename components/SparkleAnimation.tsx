'use client'

import { useEffect, useState } from 'react'

interface SparkleAnimationProps {
  isVisible: boolean
  children: React.ReactNode
}

export default function SparkleAnimation({ isVisible, children }: SparkleAnimationProps) {
  const [showSparkles, setShowSparkles] = useState(false)

  useEffect(() => {
    if (isVisible) {
      setShowSparkles(true)
      const timer = setTimeout(() => setShowSparkles(false), 2000) // Show sparkles for 2 seconds
      return () => clearTimeout(timer)
    }
  }, [isVisible])

  return (
    <div className="relative">
      {children}
      {showSparkles && (
        <div className="absolute inset-0 pointer-events-none">
          {/* Sparkle 1 */}
          <div 
            className="absolute top-1 left-2"
            style={{
              animation: 'sparklePing 2s ease-in-out infinite',
              animationDelay: '0s'
            }}
          >
            <span className="text-yellow-400 text-xs">✨</span>
          </div>
          {/* Sparkle 2 */}
          <div 
            className="absolute top-3 right-3"
            style={{
              animation: 'sparklePing 2s ease-in-out infinite',
              animationDelay: '0.3s'
            }}
          >
            <span className="text-blue-400 text-xs">⭐</span>
          </div>
          {/* Sparkle 3 */}
          <div 
            className="absolute bottom-2 left-4"
            style={{
              animation: 'sparklePing 2s ease-in-out infinite',
              animationDelay: '0.6s'
            }}
          >
            <span className="text-purple-400 text-xs">✨</span>
          </div>
          {/* Sparkle 4 */}
          <div 
            className="absolute bottom-1 right-2"
            style={{
              animation: 'sparklePing 2s ease-in-out infinite',
              animationDelay: '0.9s'
            }}
          >
            <span className="text-green-400 text-xs">⭐</span>
          </div>
          {/* Sparkle 5 */}
          <div 
            className="absolute top-2 right-1"
            style={{
              animation: 'sparklePing 2s ease-in-out infinite',
              animationDelay: '1.2s'
            }}
          >
            <span className="text-pink-400 text-xs">✨</span>
          </div>
        </div>
      )}
    </div>
  )
}
