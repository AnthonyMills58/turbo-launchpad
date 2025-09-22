import React, { useEffect, useState } from 'react'
import CryptoChart from './CryptoChart'

interface ChartFormProps {
  onCancel: () => void
  tokenId: number
  symbol: string
  wrapperClassName?: string
}

const ChartForm: React.FC<ChartFormProps> = ({ tokenId, symbol, wrapperClassName }) => {
  const [hasData, setHasData] = useState<boolean | null>(null)

  useEffect(() => {
    let isMounted = true

    const checkData = async () => {
      try {
        // Use same default interval/timeRange as CryptoChart initial load
        const response = await fetch(`/api/chart-data/${tokenId}/4h?timeRange=Max`)
        if (!response.ok) {
          setHasData(false)
          return
        }
        const payload = await response.json()
        const chartData = payload.data || payload
        const finalData = Array.isArray(chartData) ? chartData : []
        if (isMounted) setHasData(finalData.length > 0)
      } catch {
        if (isMounted) setHasData(false)
      }
    }

    checkData()

    return () => {
      isMounted = false
    }
  }, [tokenId])

  // While checking, render nothing to avoid flicker
  if (hasData !== true) return null

  return (
    <div className={wrapperClassName ?? 'w-full'}>
      <CryptoChart tokenId={tokenId} symbol={symbol} />
    </div>
  )
}

export default ChartForm
