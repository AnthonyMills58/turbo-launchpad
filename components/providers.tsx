'use client'

import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit'
import { http } from 'wagmi'
import { megaethTestnet, megaethMainnet } from '@/lib/chains' // adjust if it's in a different folder
import '@rainbow-me/rainbowkit/styles.css'
import { ReactNode, useState } from 'react'

const config = getDefaultConfig({
  appName: 'Turbo Launch',
  projectId: 'YOUR_WALLETCONNECT_PROJECT_ID', // 🔁 Replace with your real one
  chains: [megaethTestnet, megaethMainnet],
  transports: {
    [megaethTestnet.id]: http('https://carrot.megaeth.com/rpc'), // ✅ this line was missing,
    [megaethMainnet.id]: http('https://mainnet.megaeth.com/rpc'), // ❗ fake URL for now
  },
})

export function Web3Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider initialChain={megaethTestnet}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}



