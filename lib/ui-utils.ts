/**
 * UI utility functions that can be used in client components
 */

/**
 * Calculate container height based on image aspect ratio and desired width
 * @param logoWidth - Original image width
 * @param logoHeight - Original image height  
 * @param containerWidth - Desired container width
 * @returns Calculated container height
 */
export function calculateContainerHeight(logoWidth: number, logoHeight: number, containerWidth: number): number {
  if (logoWidth === 0 || logoHeight === 0) return containerWidth // fallback to square
  
  // Calculate height that maintains the image's aspect ratio
  const heightRatio = logoHeight / logoWidth
  const calculatedHeight = Math.round(containerWidth * heightRatio)
  
  // Set a minimum height to prevent containers from being too thin
  // For very wide images, ensure the container has a reasonable height
  const minHeight = Math.max(containerWidth * 0.5, 48) // At least 50% of width or 48px
  
  return Math.max(calculatedHeight, minHeight)
}

/**
 * Format price in MetaMask style for very small numbers
 * @param priceValue - Price value to format
 * @returns Object with formatted price info for JSX rendering
 */
export function formatPriceMetaMask(priceValue: number): { 
  type: 'normal' | 'metamask' | 'scientific' | 'empty'
  value: string
  zeros?: number
  digits?: string
} {
  if (priceValue === 0) return { type: 'empty', value: '—' }
  
  // For normal values, use standard formatting
  if (priceValue >= 1) return { type: 'normal', value: priceValue.toFixed(4) }
  if (priceValue >= 0.01) return { type: 'normal', value: priceValue.toFixed(6) }
  if (priceValue >= 0.001) return { type: 'normal', value: priceValue.toFixed(7) }
  
  // For very small numbers, use MetaMask style: 0.0¹²34
  // Convert to wei for zero calculation: priceValue * 1e18
  const weiValue = Math.floor(priceValue * 1e18)
  const weiStr = weiValue.toString()
  const weiLength = weiStr.length
  const zeros = 18 - weiLength
  
  if (zeros > 1) { // Avoid single zero display
    const significantDigits = weiStr.substring(0, 2)
    return { 
      type: 'metamask', 
      value: '0.0', 
      zeros, 
      digits: significantDigits 
    }
  }
  
  // Fallback to scientific notation
  return { type: 'scientific', value: priceValue.toExponential(2) }
}
