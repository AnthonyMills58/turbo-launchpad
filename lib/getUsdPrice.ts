// /lib/getUsdPrice.ts

export async function getUsdPrice(): Promise<number | null> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        // Ensures Next.js fetch cache doesn't stale the result
        cache: 'no-store',
      }
    );

    if (!res.ok) {
      console.error('Failed to fetch ETH price:', res.statusText);
      return null;
    }

    const data = await res.json();

    const price = data?.ethereum?.usd;
    return typeof price === 'number' ? price : null;
  } catch (err) {
    console.error('Error fetching ETH price from CoinGecko:', err);
    return null;
  }
}

