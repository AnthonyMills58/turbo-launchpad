'use client'

import { createContext, useContext } from 'react'

export const WalletRefreshContext = createContext<() => void>(() => {})

export const useWalletRefresh = () => useContext(WalletRefreshContext)
