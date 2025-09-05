'use client'

import { useState, useEffect } from 'react'
import { calculateContainerHeight } from '@/lib/ui-utils'

interface ExternalImageContainerProps {
  src: string
  alt: string
  baseWidth: number
  className?: string
  draggable?: boolean
}

export default function ExternalImageContainer({
  src,
  alt,
  baseWidth,
  className = '',
  draggable = false
}: ExternalImageContainerProps) {
  const [containerHeight, setContainerHeight] = useState(baseWidth) // Start with square as fallback
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    // Create a temporary image to get dimensions
    const tempImg = new window.Image()
    tempImg.onload = () => {
      const height = calculateContainerHeight(tempImg.naturalWidth, tempImg.naturalHeight, baseWidth)
      setContainerHeight(height)
      setImageLoaded(true)
    }
    tempImg.onerror = () => {
      // Fallback to square if image fails to load
      setContainerHeight(baseWidth)
      setImageLoaded(true)
      setImageError(true)
    }
    tempImg.src = src
  }, [src, baseWidth])

  if (imageError) {
    return (
      <div
        className={`bg-gray-700 rounded-lg flex items-center justify-center text-sm font-bold ${className}`}
        style={{ width: `${baseWidth}px`, height: `${containerHeight}px` }}
      >
        {alt[0]?.toUpperCase() || '?'}
      </div>
    )
  }

  return (
    <div
      className={`overflow-hidden ${className}`}
      style={{
        width: `${baseWidth}px`,
        height: `${containerHeight}px`
      }}
    >
             <img
         src={src}
         alt={alt}
         className="w-full h-full object-contain object-center"
         draggable={draggable}
         style={{ display: imageLoaded ? 'block' : 'none' }}
         onLoad={() => setImageLoaded(true)}
         onError={() => setImageError(true)}
       />
      {!imageLoaded && !imageError && (
        <div className="w-full h-full bg-gray-700 flex items-center justify-center">
          <div className="animate-pulse bg-gray-600 w-8 h-8 rounded"></div>
        </div>
      )}
    </div>
  )
}
