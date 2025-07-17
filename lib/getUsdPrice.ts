// /lib/getUsdPrice.ts

let cachedPrice: number | null = null
let lastFetched = 0
const CACHE_DURATION_MS = 60 * 1000 // 1 minute

export async function getUsdPrice(): Promise<number | null> {
  const now = Date.now()

  if (cachedPrice !== null && now - lastFetched < CACHE_DURATION_MS) {
    return cachedPrice
  }

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        cache: 'no-store',
      }
    )

    if (!res.ok) {
      console.error('Failed to fetch ETH price:', res.statusText)
      return cachedPrice // fallback to last good value
    }

    const data = await res.json()
    const price = data?.ethereum?.usd

    if (typeof price === 'number') {
      cachedPrice = price
      lastFetched = now
      return price
    }

    return cachedPrice
  } catch (err) {
    console.error('Error fetching ETH price from CoinGecko:', err)
    return cachedPrice // fallback again
  }
}


