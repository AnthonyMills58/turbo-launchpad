// Rate limiting utilities
// Extracted from workers/index.ts

import { HEADER_SLEEP_MS, getSleepMs } from './config'

export function sleep(ms: number) {
  return new Promise(res => setTimeout(res, ms))
}

type RpcLikeError = { code?: number; message?: string; error?: { code?: number; message?: string } }

export function isRateLimit(err: unknown): boolean {
  const e = err as RpcLikeError
  const code = e?.code ?? e?.error?.code
  const msg = (e?.message ?? e?.error?.message ?? '').toLowerCase()
  return code === -32016 || code === -32822 || msg.includes('rate limit') || msg.includes('over compute unit limit')
}

export async function withRateLimit<T>(
  rpcCall: () => Promise<T>,
  maxAttempts: number = 10,
  chainId?: number
): Promise<T> {
  let attempts = 0
  while (true) {
    try {
      const result = await rpcCall()
      const sleepMs = chainId ? getSleepMs(chainId) : HEADER_SLEEP_MS
      await sleep(sleepMs)
      return result
    } catch (e) {
      attempts++
      if (isRateLimit(e) && attempts <= maxAttempts) {
        // MegaETH needs much longer backoff
        const baseBackoff = chainId === 6342 ? 5000 : 2000
        const backoff = Math.min(baseBackoff * attempts, chainId === 6342 ? 30000 : 10000)
        console.log(`Rate limit hit on chain ${chainId}, retrying in ${backoff}ms (attempt ${attempts}/${maxAttempts})`)
        await sleep(backoff)
        continue
      }
      throw e
    }
  }
}
