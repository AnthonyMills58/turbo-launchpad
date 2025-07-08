'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

type FiltersContextType = {
  search: string
  setSearch: (value: string) => void
  creatorFilter: string
  setCreatorFilter: (value: string) => void
  statusFilter: string
  setStatusFilter: (value: string) => void
  sortFilter: string
  setSortFilter: (value: string) => void
}

const FiltersContext = createContext<FiltersContextType | undefined>(undefined)

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState('')
  const [creatorFilter, setCreatorFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortFilter, setSortFilter] = useState('created_desc')

  return (
    <FiltersContext.Provider value={{
      search, setSearch,
      creatorFilter, setCreatorFilter,
      statusFilter, setStatusFilter,
      sortFilter, setSortFilter,
    }}>
      {children}
    </FiltersContext.Provider>
  )
}

export function useFilters() {
  const context = useContext(FiltersContext)
  if (!context) throw new Error('useFilters must be used within a FiltersProvider')
  return context
}
