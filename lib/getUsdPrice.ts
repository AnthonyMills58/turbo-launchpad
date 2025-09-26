// /lib/getUsdPrice.ts
export async function getUsdPrice(): Promise<number | null> {
  try {
    console.log('[getUsdPrice] Fetching ETH price from CoinGecko...');

    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      }
    );

    if (!res.ok) throw new Error('CoinGecko fetch failed');

    const data = await res.json();
    const price = data?.ethereum?.usd;

    console.log('[getUsdPrice] CoinGecko returned:', price);

    if (typeof price === 'number') {
      const saveRes = await fetch('/api/eth-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price }),
      });

      console.log('[getUsdPrice] Saved price to DB. Response status:', saveRes.status);
      return price;
    } else {
      //console.warn('[getUsdPrice] CoinGecko price was not a number:', price);
    }

    return null;
  } catch (err) {
    console.warn('[getUsdPrice] CoinGecko fetch failed:', err);
    //console.log('[getUsdPrice] Trying fallback from DB...');
  }

  // Fallback: Load from DB
  try {
    const fallback = await fetch('/api/eth-price', { method: 'GET' });
    if (!fallback.ok) throw new Error(`DB fallback response status ${fallback.status}`);

    const json = await fallback.json();
    const priceFromDb = parseFloat(String(json?.price));
    const result = Number.isFinite(priceFromDb) ? priceFromDb : null;
    //console.log('[getUsdPrice] Returning fallback result:', result);
    return result;
  } catch  {
    //console.error('[getUsdPrice] Fallback fetch failed:', e);
    return null;
  }
}




