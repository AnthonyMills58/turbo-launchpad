import sharp from 'sharp'

// Runtime media functions - only imported when needed
export async function normalizeOriginal(buffer: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  let image = sharp(buffer)
  
  // Auto-rotate based on EXIF
  image = image.rotate()
  
  // Get metadata
  const metadata = await image.metadata()
  
  // Resize if larger than max dimension while maintaining aspect ratio
  if (metadata.width && metadata.height) {
    const maxDim = Math.max(metadata.width, metadata.height)
    if (maxDim > 2048) { // MAX_DIMENSION
      image = image.resize(2048, 2048, {
        fit: 'inside',
        withoutEnlargement: true
      })
    }
  }
  
  // Convert to WebP for consistency and compression
  const processedBuffer = await image.webp({ quality: 90 }).toBuffer()
  
  // Get final dimensions
  const finalMetadata = await sharp(processedBuffer).metadata()
  
  return {
    buffer: processedBuffer,
    width: finalMetadata.width || 0,
    height: finalMetadata.height || 0
  }
}

export async function makeThumbnail(buffer: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  // Get original image metadata to preserve aspect ratio
  const originalMetadata = await sharp(buffer).metadata()
  
  // Calculate thumbnail dimensions while preserving aspect ratio
  let thumbWidth: number = 200 // THUMBNAIL_SIZE
  let thumbHeight: number = 200
  
  if (originalMetadata.width && originalMetadata.height) {
    const aspectRatio = originalMetadata.width / originalMetadata.height
    
    if (aspectRatio > 1) {
      // Landscape image - fit to width
      thumbWidth = 200
      thumbHeight = Math.round(200 / aspectRatio)
    } else {
      // Portrait image - fit to height
      thumbHeight = 200
      thumbWidth = Math.round(200 * aspectRatio)
    }
  }
  
  // For landscape images, specify width only
  // For portrait images, specify height only
  // This ensures Sharp preserves aspect ratio correctly
  let thumbnail
  if (thumbWidth > thumbHeight) {
    // Landscape - specify width only
    thumbnail = await sharp(buffer)
      .resize(thumbWidth, null, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 80 })
      .toBuffer()
  } else {
    // Portrait - specify height only
    thumbnail = await sharp(buffer)
      .resize(null, thumbHeight, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 80 })
      .toBuffer()
  }
  
  // Get final thumbnail metadata to verify
  const finalMetadata = await sharp(thumbnail).metadata()
  
  // Use the ACTUAL dimensions that Sharp produced, not our calculated ones
  const actualWidth = finalMetadata.width || thumbWidth
  const actualHeight = finalMetadata.height || thumbHeight
  
  return {
    buffer: thumbnail,
    width: actualWidth,
    height: actualHeight
  }
}


