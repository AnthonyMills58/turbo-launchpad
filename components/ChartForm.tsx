import React from 'react'

interface ChartFormProps {
  onCancel: () => void
}

const ChartForm: React.FC<ChartFormProps> = ({ onCancel }) => {
  return (
    <div className="py-8 text-center text-gray-400">
      <div className="mb-2 text-2xl">📈</div>
      <div className="mb-1 text-lg font-medium">Price Chart</div>
      <div className="text-sm">
        Chart functionality coming soon...
      </div>
    </div>
  )
}

export default ChartForm
