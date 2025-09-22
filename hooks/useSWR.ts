import useSWR from 'swr'

// Generic fetcher function for SWR
const fetcher = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  return response.json()
}

// Custom hook for token list with SWR
export function useTokenList(params: URLSearchParams) {
  const key = `/api/all-tokens?${params.toString()}`
  
  return useSWR(key, fetcher, {
    refreshInterval: 180000, // 3 minutes
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 2000, // Prevent duplicate requests within 2 seconds
  })
}

// Custom hook for newest transactions with SWR
export function useNewestTransactions(chainId: number) {
  const key = chainId ? `/api/newest-transactions?chainId=${chainId}` : null
  
  return useSWR(key, fetcher, {
    refreshInterval: 60000, // 1 minute
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 2000,
  })
}

// Custom hook for individual token data
export function useTokenData(tokenId: number, chainId: number) {
  const key = tokenId && chainId ? `/api/tokens/${tokenId}?chainId=${chainId}` : null
  
  return useSWR(key, fetcher, {
    refreshInterval: 120000, // 2 minutes
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 2000,
  })
}

export { fetcher }
