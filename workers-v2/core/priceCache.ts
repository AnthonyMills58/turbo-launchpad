import pool from '../../lib/db'

/**
 * Get current ETH price in USD for workers
 * Tries to fetch from CoinGecko first, then falls back to cache
 */
export async function getCurrentEthPrice(): Promise<number | null> {
  try {
    console.log('[getCurrentEthPrice] Fetching ETH price from CoinGecko...');

    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      }
    );

    if (!res.ok) throw new Error('CoinGecko fetch failed');

    const data = await res.json() as any;
    const price = data?.ethereum?.usd;

    console.log('[getCurrentEthPrice] CoinGecko returned:', price);

    if (typeof price === 'number') {
      // Save to database directly (no HTTP API needed)
      await pool.query(
        `INSERT INTO eth_price_cache (id, price_usd, fetched_at)
         VALUES (1, $1, NOW())
         ON CONFLICT (id) DO UPDATE
         SET price_usd = EXCLUDED.price_usd,
             fetched_at = NOW()`,
        [price]
      );

      console.log('[getCurrentEthPrice] Saved price to DB');
      return price;
    }

    return null;
  } catch (err) {
    console.warn('[getCurrentEthPrice] CoinGecko fetch failed:', err);
  }

  // Fallback: Load from DB
  try {
    const { rows } = await pool.query(
      `SELECT price_usd FROM eth_price_cache WHERE id = 1`
    );
    
    const price = rows[0]?.price_usd;
    if (typeof price === 'number' && !isNaN(price)) {
      console.log('[getCurrentEthPrice] Using cached price:', price);
      return price;
    }
    
    console.warn('[getCurrentEthPrice] No valid price found in cache');
    return null;
  } catch (error) {
    console.error('[getCurrentEthPrice] Database fallback failed:', error);
    return null;
  }
}
