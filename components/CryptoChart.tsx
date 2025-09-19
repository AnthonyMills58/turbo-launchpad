import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, IChartApi, ISeriesApi, Time, CandlestickSeries, HistogramSeries } from 'lightweight-charts'

interface CryptoChartProps {
  tokenId: number
  symbol: string
}

interface CandleData {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  volumeEth: number
  volumeUsd: number
  tradesCount: number
}

const CryptoChart: React.FC<CryptoChartProps> = ({ tokenId, symbol }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const [data, setData] = useState<CandleData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedInterval, setSelectedInterval] = useState('1d') // Default to daily for better sparse data visualization

  const intervals = [
    { value: '1d', label: '1d' }, // Put daily first since it's better for sparse data
    { value: '1m', label: '1m' },
    // Only show intervals that exist in your database
    // { value: '5m', label: '5m' },
    // { value: '15m', label: '15m' },
    // { value: '1h', label: '1h' },
    // { value: '4h', label: '4h' },
  ]

  // Fetch chart data from your API
  const fetchChartData = useCallback(async () => {
    try {
      setLoading(true)
      console.log(`Fetching chart data for tokenId: ${tokenId}, interval: ${selectedInterval}`)
      
      // Try the regular endpoint first
      const response = await fetch(`/api/chart-data/${tokenId}/${selectedInterval}`)
      console.log('Response status:', response.status)
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const responseData = await response.json()
      console.log('Chart data received:', responseData)
      
      // Handle different response formats
      const chartData = responseData.data || responseData
      let finalData = Array.isArray(chartData) ? chartData : []
      
      // If we have very few data points (less than 3), try the sparse data endpoint
      if (finalData.length < 3 && selectedInterval === '1d') {
        console.log(`Only ${finalData.length} data points, trying sparse data endpoint...`)
        try {
          const sparseResponse = await fetch(`/api/chart-data/${tokenId}/sparse`)
          if (sparseResponse.ok) {
            const sparseData = await sparseResponse.json()
            console.log('Sparse data received:', sparseData)
            finalData = Array.isArray(sparseData.data) ? sparseData.data : []
            console.log(`Using sparse data: ${finalData.length} data points`)
          }
        } catch (sparseError) {
          console.log('Sparse data fetch failed, using original data:', sparseError)
        }
      }
      
      // Log volume data for debugging
      if (finalData.length > 0) {
        console.log('Sample volume data:', finalData.slice(0, 2).map(d => ({
          time: d.time,
          volumeEth: d.volumeEth,
          volumeUsd: d.volumeUsd,
          tradesCount: d.tradesCount
        })))
      }
      
      setData(finalData)
    } catch (error) {
      console.error('Error fetching chart data:', error)
      setData([]) // Set empty array on error
    } finally {
      setLoading(false)
    }
  }, [tokenId, selectedInterval])

  useEffect(() => {
    fetchChartData()
  }, [tokenId, selectedInterval, fetchChartData])

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 400,
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
      leftPriceScale: {
        borderColor: '#2a2d3a',
        visible: false, // Hide left scale for price
      },
      timeScale: {
        borderColor: '#2a2d3a',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    // Create candlestick series with more visible colors
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', // Brighter green
      downColor: '#ef4444', // Brighter red
      borderDownColor: '#ef4444',
      borderUpColor: '#10b981',
      wickDownColor: '#ef4444',
      wickUpColor: '#10b981',
    })

    // Create volume series with better visibility
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#10b981', // Green color for volume to match legend
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: 'volume', // Use separate price scale for volume
      scaleMargins: {
        top: 0.9, // Leave 90% of space for price data
        bottom: 0.0,
      },
    })

    // Set data - scale up small prices for better visibility
    const formattedData = data.map(candle => {
      // Prices are already in ETH (0.0003, 0.001), scale up moderately for visibility
      const scaledOpen = candle.open * 1000 // Scale up by 1000 for better visibility
      const scaledHigh = candle.high * 1000
      const scaledLow = candle.low * 1000
      const scaledClose = candle.close * 1000
      
      console.log(`Price data: open=${candle.open}, high=${candle.high}, low=${candle.low}, close=${candle.close}`)
      console.log(`Scaled prices: open=${scaledOpen}, high=${scaledHigh}, low=${scaledLow}, close=${scaledClose}`)
      
      return {
        time: candle.time as Time,
        open: scaledOpen,
        high: scaledHigh,
        low: scaledLow,
        close: scaledClose,
      }
    })

    const volumeData = data.map(candle => {
      // volumeEth is in wei, convert to ETH
      const volumeInEth = candle.volumeEth / 1e18
      console.log(`Volume: ${candle.volumeEth} wei -> ${volumeInEth} ETH`)
      
      // Make volume bars much smaller so they don't dominate the chart
      let scaledVolume = Math.abs(volumeInEth) // Ensure positive volume
      if (scaledVolume > 0) {
        // Scale down volume significantly to make room for price data
        scaledVolume = scaledVolume / 1000 // Much smaller volume bars
        // Ensure minimum visibility but keep it very small
        scaledVolume = Math.max(scaledVolume, 0.0001)
        scaledVolume = Math.min(scaledVolume, 0.01) // Cap at very small value
      } else {
        // Handle zero volume - show very small bar
        scaledVolume = 0.0001 // Very small positive value for visibility
      }
      
      console.log(`Final volume: ${scaledVolume}`)
      
      return {
        time: candle.time as Time,
        value: scaledVolume,
        color: '#10b981', // Green color for all volume bars to match legend
      }
    })
    
    console.log('Volume data sample:', volumeData.slice(0, 3))
    console.log('Price data sample:', formattedData.slice(0, 3))

    candlestickSeries.setData(formattedData)
    volumeSeries.setData(volumeData)
    
    console.log('Chart series created and data set')

    // Auto-fit the chart to show the full time range
    if (formattedData.length > 0) {
      chart.timeScale().fitContent()
    }

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

  if (data.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center text-gray-400">
          <div className="mb-2 text-2xl">📈</div>
          <div className="mb-1 text-lg font-medium">No Chart Data Available</div>
          <div className="text-sm">
            No price data found for {symbol}. Data may not be available yet.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">
            {symbol} Price & Volume Chart (×10³ ETH)
          </h3>
          <div className="text-sm text-gray-400">
            {data.length} candles • {selectedInterval} interval
          </div>
          <div className="mt-2 flex gap-4 text-xs text-gray-500">
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 rounded-sm bg-green-500"></div>
              <span>Price (Candlesticks)</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-2 w-4 bg-green-500"></div>
              <span>Volume (Bars)</span>
            </div>
          </div>
        </div>
        
        {/* Interval selector buttons */}
        <div className="flex gap-1">
          {intervals.map(interval => (
            <button
              key={interval.value}
              onClick={() => setSelectedInterval(interval.value)}
              className={`px-3 py-1 text-sm transition ${
                selectedInterval === interval.value
                  ? 'bg-gray-600 text-white'
                  : 'bg-transparent text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {interval.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={chartContainerRef} className="w-full" />
    </div>
  )
}

export default CryptoChart
