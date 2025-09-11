// Rate limiting utilities
// Extracted from workers/index.ts

import { HEADER_SLEEP_MS } from './config'

export function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms))
}

type RpcLikeError = { code?: number; message?: string; error?: { code?: number; message?: string } }

export function isRateLimit(err: unknown): boolean {
  const e = err as RpcLikeError
  const code = e?.code ?? e?.error?.code
  const msg = (e?.message ?? e?.error?.message ?? '').toLowerCase()
  return code === -32016 || msg.includes('rate limit')
}

export async function withRateLimit<T>(
  rpcCall: () => Promise<T>,
  maxAttempts: number = 10
): Promise<T> {
  let attempts = 0
  while (true) {
    try {
      const result = await rpcCall()
      await sleep(HEADER_SLEEP_MS)
      return result
    } catch (e) {
      attempts++
      if (isRateLimit(e) && attempts <= maxAttempts) {
        const backoff = Math.min(2000 * attempts, 10000) // Increased backoff
        console.log(`Rate limit hit, retrying in ${backoff}ms (attempt ${attempts}/${maxAttempts})`)
        await sleep(backoff)
        continue
      }
      throw e
    }
  }
}
