import React from 'react'
import CryptoChart from './CryptoChart'

interface ChartFormProps {
  onCancel: () => void
  tokenId: number
  symbol: string
}

const ChartForm: React.FC<ChartFormProps> = ({ tokenId, symbol }) => {
  return (
    <div className="w-full">
      <CryptoChart tokenId={tokenId} symbol={symbol} />
    </div>
  )
}

export default ChartForm
