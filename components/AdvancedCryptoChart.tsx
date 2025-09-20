import React, { useEffect, useRef, useState } from 'react'
import { createChart, IChartApi, ISeriesApi, Time, CandlestickSeries, HistogramSeries } from 'lightweight-charts'

interface AdvancedCryptoChartProps {
  tokenId: number
  symbol: string
}

interface CandleData {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  volumeEth: number
  volumeUsd: number
  tradesCount: number
}

const AdvancedCryptoChart: React.FC<AdvancedCryptoChartProps> = ({ tokenId, symbol }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const [data, setData] = useState<CandleData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedInterval, setSelectedInterval] = useState('1d')
  const [stats, setStats] = useState({
    totalVolume: 0,
    totalTrades: 0,
    priceChange: 0,
    priceChangePercent: 0
  })

  const intervals = [
    { value: '1h', label: '1H' },
    { value: '4h', label: '4H' },
    { value: '1d', label: '1D' },
    { value: '1w', label: '1W' }
  ]

  // Fetch chart data from your API
  const fetchChartData = async (interval: string) => {
    try {
      setLoading(true)
      const response = await fetch(`/api/chart-data/${tokenId}/${interval}`)
      const result = await response.json()
      
      if (result.data) {
        setData(result.data)
        
        // Calculate stats
        if (result.data.length > 0) {
          const firstCandle = result.data[result.data.length - 1] // Oldest
          const lastCandle = result.data[0] // Newest
          
          const totalVolume = result.data.reduce((sum: number, candle: CandleData) => sum + candle.volumeEth, 0)
          const totalTrades = result.data.reduce((sum: number, candle: CandleData) => sum + candle.tradesCount, 0)
          const priceChange = lastCandle.close - firstCandle.open
          const priceChangePercent = firstCandle.open > 0 ? (priceChange / firstCandle.open) * 100 : 0
          
          setStats({
            totalVolume,
            totalTrades,
            priceChange,
            priceChangePercent
          })
        }
      }
    } catch (error) {
      console.error('Error fetching chart data:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchChartData(selectedInterval)
  }, [tokenId, selectedInterval])

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { color: '#151827' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#2a2d3a' },
        horzLines: { color: '#2a2d3a' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#2a2d3a',
      },
      timeScale: {
        borderColor: '#2a2d3a',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    // Create candlestick series
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderDownColor: '#ef5350',
      borderUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      wickUpColor: '#26a69a',
    })

    // Create volume series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    })

    // Set data
    const formattedData = data.map(candle => ({
      time: candle.time as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }))

    const volumeData = data.map(candle => ({
      time: candle.time as Time,
      value: candle.volumeEth,
      color: candle.close >= candle.open ? '#26a69a' : '#ef5350',
    }))

    candlestickSeries.setData(formattedData)
    volumeSeries.setData(volumeData)

    // Store references
    chartRef.current = chart
    candlestickSeriesRef.current = candlestickSeries
    volumeSeriesRef.current = volumeSeries

    // Handle resize
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        })
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (chartRef.current) {
        chartRef.current.remove()
      }
    }
  }, [data])

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-gray-400">Loading chart data...</div>
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* Header with stats and interval selector */}
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">
            {symbol} Price Chart
          </h3>
          <div className="flex gap-4 text-sm text-gray-400">
            <span>Volume: {stats.totalVolume.toFixed(4)} ETH</span>
            <span>Trades: {stats.totalTrades.toLocaleString()}</span>
            <span className={stats.priceChange >= 0 ? 'text-green-400' : 'text-red-400'}>
              {stats.priceChange >= 0 ? '+' : ''}{stats.priceChangePercent.toFixed(2)}%
            </span>
          </div>
        </div>
        
        {/* Interval selector */}
        <div className="flex gap-1">
          {intervals.map(interval => (
            <button
              key={interval.value}
              onClick={() => setSelectedInterval(interval.value)}
              className={`px-3 py-1 text-sm transition ${
                selectedInterval === interval.value
                  ? 'bg-gray-600 text-white'
                  : 'bg-transparent text-gray-400 hover:text-white'
              }`}
            >
              {interval.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart container */}
      <div ref={chartContainerRef} className="w-full" />
      
      {/* Data info */}
      <div className="mt-2 text-xs text-gray-500">
        Showing {data.length} candles for {selectedInterval} interval
      </div>
    </div>
  )
}

export default AdvancedCryptoChart
