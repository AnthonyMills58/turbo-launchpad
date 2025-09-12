// Worker configuration constants
// Extracted from workers/index.ts and workers/pools.ts

// Event topics
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' // Transfer(address,address,uint256)
export const SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822' // Swap(address,uint256,uint256,uint256,uint256,address)
export const SYNC_TOPIC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1' // Sync(uint112,uint112)

// Constants
export const ZERO = '0x0000000000000000000000000000000000000000'

// Environment variables
export const ONLY_TOKEN_ID = process.env.TOKEN_ID ? Number(process.env.TOKEN_ID) : undefined

// Tunables
export const DEFAULT_CHUNK = Number(process.env.WORKER_CHUNK ?? 10000)         // blocks per query (reduced for MegaETH rate limits)
export const DEFAULT_DEX_CHUNK = Number(process.env.DEX_CHUNK ?? 500)          // blocks per DEX query (further reduced for rate limiting)
export const HEADER_SLEEP_MS = Number(process.env.WORKER_SLEEP_MS ?? 200)      // ms between getBlock calls (increased for rate limiting)

// Chain-specific rate limiting (configurable via environment variables)
export function getChunkSize(chainId: number): number {
  if (chainId === 6342) return Number(process.env.MEGAETH_CHUNK ?? 10000)   // MegaETH: faster chunks
  if (chainId === 11155111) return Number(process.env.SEPOLIA_CHUNK ?? 20000)  // Sepolia: larger chunks
  return DEFAULT_CHUNK
}

export function getDexChunkSize(chainId: number): number {
  if (chainId === 6342) return Number(process.env.MEGAETH_DEX_CHUNK ?? 1000)    // MegaETH: faster chunks
  if (chainId === 11155111) return Number(process.env.SEPOLIA_DEX_CHUNK ?? 1000)   // Sepolia: normal chunks
  return DEFAULT_DEX_CHUNK
}

export function getSleepMs(chainId: number): number {
  if (chainId === 6342) return Number(process.env.MEGAETH_SLEEP_MS ?? 100)    // MegaETH: minimal delays
  if (chainId === 11155111) return Number(process.env.SEPOLIA_SLEEP_MS ?? 50)    // Sepolia: minimal delays
  return HEADER_SLEEP_MS
}
export const REORG_CUSHION = Math.max(0, Number(process.env.REORG_CUSHION ?? 5))
export const ADDR_BATCH_LIMIT = Math.max(1, Number(process.env.ADDR_BATCH_LIMIT ?? 200)) // addresses per getLogs
export const SKIP_HEALTH_CHECK = process.env.SKIP_HEALTH_CHECK === 'true'      // skip chain health checks
export const HEALTH_CHECK_TIMEOUT = Number(process.env.HEALTH_CHECK_TIMEOUT ?? 10000) // health check timeout in ms

// Singleton advisory lock (prevent overlapping runs)
export const LOCK_NS = 42
export const LOCK_ID = 1
