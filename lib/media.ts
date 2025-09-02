import sharp from 'sharp'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs/promises'

// Constants
export const MEDIA_CONSTANTS = {
  MAX_FILE_SIZE_BYTES: 2 * 1024 * 1024, // 2MB
  MAX_DIMENSION: 2048,
  THUMBNAIL_SIZE: 200,
  ALLOWED_MIME_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
  UPLOAD_DIR: 'uploads',
  THUMBNAIL_DIR: 'thumbnails'
} as const

// Map to your enum values
export const MEDIA_VARIANTS = {
  ORIGINAL: 'orig',
  THUMBNAIL: 'thumb'
} as const

// MIME type detection from file buffer
export function sniffMime(buffer: Buffer): string {
  // Check PNG signature
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png'
  }
  
  // Check JPEG signature
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg'
  }
  
  // Check WebP signature
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return 'image/webp'
  }
  
  throw new Error('Unsupported image format')
}

// Generate SHA256 hash of buffer
export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

// Normalize original image (rotate, resize if needed)
export async function normalizeOriginal(buffer: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  let image = sharp(buffer)
  
  // Auto-rotate based on EXIF
  image = image.rotate()
  
  // Get metadata
  const metadata = await image.metadata()
  
  // Resize if larger than max dimension while maintaining aspect ratio
  if (metadata.width && metadata.height) {
    const maxDim = Math.max(metadata.width, metadata.height)
    if (maxDim > MEDIA_CONSTANTS.MAX_DIMENSION) {
      image = image.resize(MEDIA_CONSTANTS.MAX_DIMENSION, MEDIA_CONSTANTS.MAX_DIMENSION, {
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

// Create thumbnail from buffer
export async function makeThumbnail(buffer: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  // Get original image metadata to preserve aspect ratio
  const originalMetadata = await sharp(buffer).metadata()
  
  // Calculate thumbnail dimensions while preserving aspect ratio
  let thumbWidth: number = MEDIA_CONSTANTS.THUMBNAIL_SIZE
  let thumbHeight: number = MEDIA_CONSTANTS.THUMBNAIL_SIZE
  
  if (originalMetadata.width && originalMetadata.height) {
    const aspectRatio = originalMetadata.width / originalMetadata.height
    
    if (aspectRatio > 1) {
      // Landscape image - fit to width
      thumbWidth = MEDIA_CONSTANTS.THUMBNAIL_SIZE
      thumbHeight = Math.round(MEDIA_CONSTANTS.THUMBNAIL_SIZE / aspectRatio)
    } else {
      // Portrait image - fit to height
      thumbHeight = MEDIA_CONSTANTS.THUMBNAIL_SIZE
      thumbWidth = Math.round(MEDIA_CONSTANTS.THUMBNAIL_SIZE * aspectRatio)
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

// Ensure upload directories exist
export async function ensureUploadDirs(): Promise<void> {
  const dirs = [MEDIA_CONSTANTS.UPLOAD_DIR, MEDIA_CONSTANTS.THUMBNAIL_DIR]
  
  for (const dir of dirs) {
    try {
      await fs.access(dir)
    } catch {
      await fs.mkdir(dir, { recursive: true })
    }
  }
}

// Generate file path for media variant
export function generateFilePath(assetId: string, variant: 'original' | 'thumbnail', extension: string = 'webp'): string {
  const dir = variant === 'thumbnail' ? MEDIA_CONSTANTS.THUMBNAIL_DIR : MEDIA_CONSTANTS.UPLOAD_DIR
  return path.join(dir, `${assetId}-${variant}.${extension}`)
}

// Validate file size
export function validateFileSize(sizeBytes: number): boolean {
  return sizeBytes <= MEDIA_CONSTANTS.MAX_FILE_SIZE_BYTES
}

// Validate MIME type
export function validateMimeType(mimeType: string): boolean {
  return MEDIA_CONSTANTS.ALLOWED_MIME_TYPES.includes(mimeType as 'image/png' | 'image/jpeg' | 'image/webp')
}

// Calculate container height based on logo dimensions while keeping consistent width


// Get file extension from MIME type
export function getExtensionFromMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    default: return 'webp'
  }
}
