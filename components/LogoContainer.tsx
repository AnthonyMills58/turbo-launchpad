'use client'

import { useState, useEffect } from 'react'
import { calculateContainerHeight } from '@/lib/ui-utils'

interface LogoContainerProps {
  src: string
  alt: string
  baseWidth: number // Base width to maintain across all containers
  className?: string
  onError?: () => void
  draggable?: boolean
}

export default function LogoContainer({ 
  src, 
  alt, 
  baseWidth, 
  className = '', 
  onError,
  draggable = false 
}: LogoContainerProps) {
  const [containerHeight, setContainerHeight] = useState(baseWidth) // Start with square as fallback
  

  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    console.log('🔍 LogoContainer: Loading image:', src, 'baseWidth:', baseWidth)
    // Create a temporary image to get dimensions
    const img = new Image()
    img.onload = () => {
      console.log('✅ LogoContainer: Image loaded successfully')
      console.log('📏 Natural dimensions:', img.naturalWidth, 'x', img.naturalHeight)
      const height = calculateContainerHeight(img.naturalWidth, img.naturalHeight, baseWidth)
      console.log('🧮 Calculated height:', height, 'for baseWidth:', baseWidth)
      setContainerHeight(height)
      setImageLoaded(true)
    }
    img.onerror = () => {
      console.log('❌ LogoContainer: Image failed to load:', src)
      // Fallback to square if image fails to load
      setContainerHeight(baseWidth)
      setImageLoaded(true)
      setImageError(true)
      if (onError) onError()
    }
    img.src = src
  }, [src, baseWidth, onError])


  return (
    <div 
      className={`overflow-hidden ${className}`}
      style={{ 
        width: `${baseWidth}px`, 
        height: `${containerHeight}px`
      }}
    >
      {!imageError && (
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-contain object-center"
          draggable={draggable}
          style={{ display: imageLoaded ? 'block' : 'none' }}
        />
      )}
      {!imageLoaded && !imageError && (
        <div className="w-full h-full bg-gray-700 flex items-center justify-center">
          <div className="animate-pulse bg-gray-600 w-8 h-8 rounded"></div>
        </div>
      )}

    </div>
  )
}
