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
  const [selectedInterval, setSelectedInterval] = useState('1d')
  const [priceScale, setPriceScale] = useState(1)
  const [volumeScale, setVolumeScale] = useState(1)

  const intervals = [
    { value: '1m', label: '1m' },
    { value: '1d', label: '1d' },
    { value: '1w', label: '1w' },
    { value: '1M', label: '1M' },
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
      
      // Handle response format - new API returns clean data
      const chartData = responseData.data || responseData
      const finalData = Array.isArray(chartData) ? chartData : []
      
      console.log(`Received ${finalData.length} data points from token_chart_agg`)
      setData(finalData)
    } catch (error) {
      console.error('Error fetching chart data:', error)
      setData([])
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
        visible: true,
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

    // Create volume series with its own price scale
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: 'volume', // Use separate price scale for volume
    })

    // Calculate scaling for small ETH values
    const maxPrice = Math.max(...data.map(c => Math.max(c.open, c.high, c.low, c.close)))
    const maxVolume = Math.max(...data.map(c => Math.abs(c.volumeEth)))
    
    // Calculate appropriate scaling factors for visibility
    const calculatedPriceScale = maxPrice > 0 ? Math.pow(10, Math.ceil(-Math.log10(maxPrice))) : 1
    const calculatedVolumeScale = maxVolume > 0 ? Math.pow(10, Math.ceil(-Math.log10(maxVolume))) : 1
    
    console.log(`Chart scaling - maxPrice: ${maxPrice}, maxVolume: ${maxVolume}`)
    console.log(`Price scale: ${calculatedPriceScale}, Volume scale: ${calculatedVolumeScale}`)
    
    // Update state for use in JSX
    setPriceScale(calculatedPriceScale)
    setVolumeScale(calculatedVolumeScale)
    
    // Apply scaling to data
    const formattedData = data.map(candle => ({
      time: candle.time as Time,
      open: candle.open * calculatedPriceScale,
      high: candle.high * calculatedPriceScale,
      low: candle.low * calculatedPriceScale,
      close: candle.close * calculatedPriceScale,
    }))

    const volumeData = data.map(candle => ({
      time: candle.time as Time,
      value: Math.abs(candle.volumeEth) * calculatedVolumeScale,
      color: candle.close >= candle.open ? '#26a69a' : '#ef5350',
    }))

    candlestickSeries.setData(formattedData)
    volumeSeries.setData(volumeData)

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
            {symbol} Price Chart
            {data.length > 0 && (
              <span className="text-sm font-normal text-gray-400 ml-2">
                (×10⁻{Math.log10(priceScale)}) ETH
              </span>
            )}
          </h3>
          <div className="text-sm text-gray-400">
            {data.length} candles • {selectedInterval} interval
          </div>
          
          {/* Chart Legend */}
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 border border-green-400 bg-green-400/20"></div>
              <span>Price (Candlesticks)</span>
              {priceScale !== 1 && (
                <span className="text-gray-500">×10⁻{Math.log10(priceScale)}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 bg-teal-400"></div>
              <span>Volume (Bars)</span>
              {volumeScale !== 1 && (
                <span className="text-gray-500">×10⁻{Math.log10(volumeScale)}</span>
              )}
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