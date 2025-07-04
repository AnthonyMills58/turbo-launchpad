'use client'

import { useAccount, useBalance } from 'wagmi'
import NavBar from './NavBar'
import { WalletRefreshContext } from '@/lib/WalletRefreshContext'

export default function NavBarWrapper() {
  const { address } = useAccount()
  const { refetch } = useBalance({
    address: address,
    query: {
      enabled: !!address,
    },
  })

  return (
    <WalletRefreshContext.Provider value={refetch}>
      <NavBar />
    </WalletRefreshContext.Provider>
  )
}

