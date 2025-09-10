'use client'

import { ReactNode, useState } from 'react'
import { WagmiProvider } from 'wagmi'
import { http } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'

import { megaethTestnet, megaethMainnet, sepoliaTestnet } from '@/lib/chains'
import { getRpcUrl } from '@/lib/providers'

const config = getDefaultConfig({
  appName: 'Turbo Launch',
  projectId: 'YOUR_WALLETCONNECT_PROJECT_ID', // replace this!
  chains: [megaethMainnet, megaethTestnet, sepoliaTestnet],
  transports: {
    [megaethMainnet.id]: http(getRpcUrl(megaethMainnet.id)),
    [megaethTestnet.id]: http(getRpcUrl(megaethTestnet.id)),
    [sepoliaTestnet.id]: http(getRpcUrl(sepoliaTestnet.id)),
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




