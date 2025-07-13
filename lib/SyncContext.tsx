'use client'

import { createContext, useContext, useState, useCallback } from 'react'

type SyncContextType = {
  refreshKey: number
  triggerSync: () => void
}

const SyncContext = createContext<SyncContextType>({
  refreshKey: 0,
  triggerSync: () => {},
})

export const SyncProvider = ({ children }: { children: React.ReactNode }) => {
  const [refreshKey, setRefreshKey] = useState(0)

  const triggerSync = useCallback(() => {
    setRefreshKey(prev => prev + 1)
  }, [])

  return (
    <SyncContext.Provider value={{ refreshKey, triggerSync }}>
      {children}
    </SyncContext.Provider>
  )
}

export const useSync = () => useContext(SyncContext)
