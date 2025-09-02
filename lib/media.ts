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

// Build-time safe media functions
// These will be replaced with actual implementations at runtime
export async function normalizeOriginal(_buffer: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  // This function will be dynamically imported at runtime
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  throw new Error('Media functions not available during build')
}

export async function makeThumbnail(_buffer: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  // This function will be dynamically imported at runtime
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  throw new Error('Media functions not available during build')
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

// Get file extension from MIME type
export function getExtensionFromMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    default: return 'webp'
  }
}
