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
