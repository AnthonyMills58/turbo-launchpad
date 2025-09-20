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
        visible: true,
        borderVisible: true,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
        entireTextOnly: false,
      },
      leftPriceScale: {
        borderColor: '#2a2d3a',
        visible: true,
        borderVisible: true,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
        entireTextOnly: false,
      },
      timeScale: {
        borderColor: '#2a2d3a',
        timeVisible: true,
        secondsVisible: false,
      },
      localization: {
        priceFormatter: (value: number) => {
          // Conditional formatting: scientific notation for values < 0.001, 2 decimals for higher
          if (Math.abs(value) < 0.001) {
            const exponent = Math.floor(Math.log10(Math.abs(value)));
            const mantissa = value / Math.pow(10, exponent);
            return `${mantissa.toFixed(2)}e${exponent}`;
          } else {
            return value.toFixed(2);
          }
        },
      },
    })

    // Create candlestick series - use left Y-axis
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00ff88', // Bright green for up candles
      downColor: '#ff4444', // Bright red for down candles
      borderDownColor: '#ff4444',
      borderUpColor: '#00ff88',
      wickDownColor: '#ff4444',
      wickUpColor: '#00ff88',
      priceScaleId: 'left', // Use left Y-axis for prices
      priceFormat: {
        type: 'price',
        precision: 6, // Reasonable precision for small values
        minMove: 1e-12, // Very small minimum movement
      },
    })

    // Create volume series - use right Y-axis
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a99', // 60% transparent green (99 = 60% opacity in hex)
      priceFormat: {
        type: 'volume',
        precision: 6, // Same precision as price series for small values
        minMove: 1e-12, // Very small minimum movement for tiny volumes
      },
      priceScaleId: 'right', // Use right Y-axis for volumes
    })

    // Calculate scaling for small ETH values
    const maxPrice = Math.max(...data.map(c => Math.max(c.open, c.high, c.low, c.close)))
    const maxVolume = Math.max(...data.map(c => Math.abs(c.volumeEth)))
    
    // Calculate appropriate scaling factors for visibility
    const calculatedPriceScale = maxPrice > 0 ? Math.pow(10, Math.ceil(-Math.log10(maxPrice))) : 1
    const calculatedVolumeScale = maxVolume > 0 ? Math.pow(10, Math.ceil(-Math.log10(maxVolume))) : 1
    
    console.log(`Chart scaling - maxPrice: ${maxPrice}, maxVolume: ${maxVolume}`)
    console.log(`Price scale: ${calculatedPriceScale}, Volume scale: ${calculatedVolumeScale}`)
    
    // No state updates needed
    
    // Send original values to chart engine - no multiplication
    const originalData = data.map(candle => ({
      time: candle.time as Time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }))

    const volumeData = data.map(candle => ({
      time: candle.time as Time,
      value: Math.abs(candle.volumeEth),
      color: candle.close >= candle.open ? '#26a69a99' : '#ef535099', // 60% transparent colors
    }))

    console.log('Sample original price data:', data.slice(0, 3).map(d => ({ open: d.open, close: d.close })))
    console.log('Sample volume data:', volumeData.slice(0, 3))

    candlestickSeries.setData(originalData)
    volumeSeries.setData(volumeData) // Volume series enabled on right Y-axis

    // Log data ranges and set manual scaling
    if (originalData.length > 0) {
      const priceMin = Math.min(...originalData.map(d => Math.min(d.open, d.high, d.low, d.close)))
      const priceMax = Math.max(...originalData.map(d => Math.max(d.open, d.high, d.low, d.close)))
      const priceRange = priceMax - priceMin
      
      const volumeMin = Math.min(...volumeData.map(d => d.value))
      const volumeMax = Math.max(...volumeData.map(d => d.value))
      const volumeRange = volumeMax - volumeMin
      
      console.log(`Original price range: ${priceMin} to ${priceMax} (range: ${priceRange})`)
      console.log(`Volume range: ${volumeMin} to ${volumeMax} (range: ${volumeRange})`)
      
      // Calculate manual range: max = 2x highest price, min = 0
      const manualPriceMax = priceMax * 2
      const manualPriceMin = 0
      
      console.log(`Original price max: ${priceMax}`)
      console.log(`Manual price scale: ${manualPriceMin} to ${manualPriceMax}`)
      
      // Determine formatting based on price range
      const useScientificNotation = priceMax < 0.001
      console.log(`Use scientific notation: ${useScientificNotation} (priceMax: ${priceMax})`)
      
      // Prices use automatic scaling (autoscaleInfoProvider removed)
      // For manual scaling, use: candlestickSeries.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue, maxValue } }) })
      
      // Apply custom tick formatting for tiny prices
      candlestickSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.1 },
      })
      
      // Apply same formatting logic for volumes
      const useScientificNotationVolume = volumeMax < 0.001
      console.log(`Use scientific notation for volume: ${useScientificNotationVolume} (volumeMax: ${volumeMax})`)
      
      // Apply custom tick formatting for volumes (same as prices)
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.1 },
      })
    }

    // Auto-fit the chart to show the full time range
    if (originalData.length > 0) {
      chart.timeScale().fitContent()
      
      // Force chart to redraw and show Y-axis with labels
      setTimeout(() => {
        chart.applyOptions({
          rightPriceScale: {
            visible: true,
            borderVisible: true,
            entireTextOnly: false,
          },
          leftPriceScale: {
            visible: true,
            borderVisible: true,
            entireTextOnly: false,
          },
        })
        
        chart.priceScale('right').applyOptions({
          visible: true,
          borderVisible: true,
          entireTextOnly: false,
          scaleMargins: {
            top: 0.1,
            bottom: 0.1,
          },
        })
      }, 100)
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
                ETH
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
            </div>
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 bg-teal-400"></div>
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
      <div className="relative w-full">
        <div ref={chartContainerRef} className="w-full px-16" />
        {/* Y-axis labels */}
        <div className="absolute left-2 top-1/2 transform -translate-y-1/2 -rotate-90 text-xs text-gray-400 font-medium whitespace-nowrap">
          Price (ETH)
        </div>
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 -rotate-90 text-xs text-gray-400 font-medium whitespace-nowrap">
          Volume (ETH)
        </div>
      </div>
    </div>
  )
}

export default CryptoChart