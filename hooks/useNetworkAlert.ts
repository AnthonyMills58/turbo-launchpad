'use client'

import { useEffect, useState } from 'react'
import { useChainId, useAccount } from 'wagmi'

export function useNetworkAlert() {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const [hasAlerted, setHasAlerted] = useState(false)

  useEffect(() => {
    if (isConnected && !hasAlerted) {
      //const networkName = getNetworkName(chainId)
      //alert(`✅ Connected to ${networkName}`)
      setHasAlerted(true)
    }
  }, [isConnected, chainId, hasAlerted])
}
