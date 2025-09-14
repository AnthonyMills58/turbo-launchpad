// Worker V2 Configuration
// Clean, focused configuration for the new worker

// Environment variables
export const ONLY_TOKEN_ID = process.env.TOKEN_ID ? Number(process.env.TOKEN_ID) : undefined

// Tunables
export const DEFAULT_CHUNK = Number(process.env.WORKER_CHUNK ?? 10000)
export const DEFAULT_DEX_CHUNK = Number(process.env.DEX_CHUNK ?? 500)
export const HEADER_SLEEP_MS = Number(process.env.WORKER_SLEEP_MS ?? 200)

// Chain-specific rate limiting (configurable via environment variables)
export function getChunkSize(chainId: number): number {
  if (chainId === 6342) return Number(process.env.MEGAETH_CHUNK ?? 1000)   // MegaETH: moderate chunks for balanced processing
  if (chainId === 11155111) return Number(process.env.SEPOLIA_CHUNK ?? 5000)  // Sepolia: smaller chunks
  return DEFAULT_CHUNK
}

export function getDexChunkSize(chainId: number): number {
  if (chainId === 6342) return Number(process.env.MEGAETH_DEX_CHUNK ?? 500)    // MegaETH: moderate chunks for balanced processing
  if (chainId === 11155111) return Number(process.env.SEPOLIA_DEX_CHUNK ?? 1000)   // Sepolia: normal chunks
  return DEFAULT_DEX_CHUNK
}

export function getSleepMs(chainId: number): number {
  if (chainId === 6342) return Number(process.env.MEGAETH_SLEEP_MS ?? 3000)    // MegaETH: very conservative delays
  if (chainId === 11155111) return Number(process.env.SEPOLIA_SLEEP_MS ?? 500)    // Sepolia: more conservative delays
  return HEADER_SLEEP_MS
}

// Other settings
export const REORG_CUSHION = Math.max(0, Number(process.env.REORG_CUSHION ?? 5))
export const ADDR_BATCH_LIMIT = Math.max(1, Number(process.env.ADDR_BATCH_LIMIT ?? 200))
export const SKIP_HEALTH_CHECK = process.env.SKIP_HEALTH_CHECK === 'true'
export const HEALTH_CHECK_TIMEOUT = Number(process.env.HEALTH_CHECK_TIMEOUT ?? 10000)

// Retry configuration
export const MAX_RETRY_ATTEMPTS = Math.max(1, Number(process.env.MAX_RETRY_ATTEMPTS ?? 9))

// Singleton advisory lock (prevent overlapping runs)
export const LOCK_NS = 42
export const LOCK_ID = 1 // Same as old worker to prevent overlapping runs