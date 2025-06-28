'use client'

import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit'
import { http } from 'wagmi'
import { sepolia } from 'viem/chains'
import '@rainbow-me/rainbowkit/styles.css'
import { ReactNode, useState } from 'react'

const config = getDefaultConfig({
  appName: 'Turbo Launch',
  projectId: 'YOUR_WALLETCONNECT_PROJECT_ID', // 🔁 Replace this with your real WalletConnect ID
  chains: [sepolia],
  transports: {
    [sepolia.id]: http(), // You can use a custom RPC if needed
  },
})

export function Web3Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}


