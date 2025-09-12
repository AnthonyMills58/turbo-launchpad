// Rate limiting utilities for Worker V2
// Clean, focused rate limiting with chain-specific backoff

import { getSleepMs } from './config'

export function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms))
}

export function isRateLimit(e: unknown): boolean {
  const error = e as { code?: number; error?: { code?: number; message?: string }; message?: string }
  const code = error?.code ?? error?.error?.code
  const msg = (error?.message ?? error?.error?.message ?? '').toLowerCase()
  return code === -32016 || code === -32822 || msg.includes('rate limit') || msg.includes('over compute unit limit')
}

export async function withRateLimit<T>(
  rpcCall: () => Promise<T>,
  maxAttempts: number = 2,
  chainId?: number
): Promise<T> {
  let attempts = 0
  while (true) {
    try {
      const result = await rpcCall()
      const sleepMs = chainId ? getSleepMs(chainId) : 200
      await sleep(sleepMs)
      return result
    } catch (e) {
      attempts++
      if (isRateLimit(e) && attempts <= maxAttempts) {
        // 2000ms delay, max 2 attempts
        const backoff = 2000
        console.log(`Rate limit hit on chain ${chainId}, retrying in ${backoff}ms (attempt ${attempts}/${maxAttempts})`)
        await sleep(backoff)
        continue
      }
      throw e
    }
  }
}
