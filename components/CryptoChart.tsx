import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, IChartApi, ISeriesApi, Time, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'

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
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const [data, setData] = useState<CandleData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTimeRange, setSelectedTimeRange] = useState('Max')

  // Fetch chart data from your API
  const fetchChartData = useCallback(async () => {
    try {
      setLoading(true)
      console.log(`Fetching chart data for tokenId: ${tokenId}, interval: 4h`)
      
      // Try the regular endpoint first with time range parameter
      const response = await fetch(`/api/chart-data/${tokenId}/4h?timeRange=${selectedTimeRange}`)
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
  }, [tokenId, selectedTimeRange])

  useEffect(() => {
    fetchChartData()
  }, [tokenId, fetchChartData])

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth - 120, // Subtract padding from width
      height: 400, // Reduced height to leave more space for other components
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
          // Conditional formatting: scientific notation for values < 0.01, 2 decimals for higher
          if (Math.abs(value) < 0.01) {
            const exponent = Math.floor(Math.log10(Math.abs(value)));
            const mantissa = value / Math.pow(10, exponent);
            return `${mantissa.toFixed(2)}e${exponent}`;
          } else {
            return value.toFixed(2);
          }
        },
      },
    })

    // Create volume series - use left Y-axis (first series)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a', // 0% transparent green (solid)
      priceFormat: {
        type: 'volume',
        precision: 6, // Same precision as price series for small values
        minMove: 1e-12, // Very small minimum movement for tiny volumes
      },
      priceScaleId: 'left', // Use left Y-axis for volumes (first series)
    })

    // Create candlestick series - use right Y-axis (second series)
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00ff8880', // 50% transparent green for up candles
      downColor: '#ff444480', // 50% transparent red for down candles
      borderDownColor: '#ff444480',
      borderUpColor: '#00ff8880',
      wickDownColor: '#ff444480',
      wickUpColor: '#00ff8880',
      priceScaleId: 'right', // Use right Y-axis for prices (second series)
      priceFormat: {
        type: 'price',
        precision: 6, // Reasonable precision for small values
        minMove: 1e-12, // Very small minimum movement
      },
    })

    // Create line series to connect closing prices - use right Y-axis (same as candlesticks)
    const lineSeries = chart.addSeries(LineSeries, {
      color: '#00ff8880', // 50% transparent green (80 = 50% opacity in hex)
      lineWidth: 1, // Thinner line
      lineStyle: 1, // Dashed line (0 = solid, 1 = dashed, 2 = dotted)
      priceScaleId: 'right', // Use right Y-axis for prices (same as candlesticks)
      priceFormat: {
        type: 'price',
        precision: 6, // Same precision as candlesticks
        minMove: 1e-12, // Same minimum movement as candlesticks
      },
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

    // Create line data from closing prices
    const lineData = data.map(candle => ({
      time: candle.time as Time,
      value: candle.close, // Use closing price for the line
    }))

    console.log('Sample original price data:', data.slice(0, 3).map(d => ({ open: d.open, close: d.close })))
    console.log('Sample volume data:', volumeData.slice(0, 3))
    console.log('Sample line data:', lineData.slice(0, 3))

    candlestickSeries.setData(originalData)
    volumeSeries.setData(volumeData) // Volume series enabled on right Y-axis
    lineSeries.setData(lineData) // Line series connecting closing prices

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
      const useScientificNotation = priceMax < 0.01
      console.log(`Use scientific notation: ${useScientificNotation} (priceMax: ${priceMax})`)
      
      // Prices (right axis) use automatic scaling (autoscaleInfoProvider removed)
      // For manual scaling, use: candlestickSeries.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue, maxValue } }) })
      
      // Apply custom tick formatting for prices (right axis)
      candlestickSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.1 },
      })
      
      // Apply same formatting logic for volumes (left axis)
      const useScientificNotationVolume = volumeMax < 0.01
      console.log(`Use scientific notation for volume: ${useScientificNotationVolume} (volumeMax: ${volumeMax})`)
      
      // Apply custom tick formatting for volumes (left axis)
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.1 },
      })
      
      // Manual scaling for volumes: max = 3x highest volume, min = 0 (increased from 2x)
      const manualVolumeMax = volumeMax * 3
      const manualVolumeMin = 0
      
      console.log(`Original volume max: ${volumeMax}`)
      console.log(`Manual volume scale: ${manualVolumeMin} to ${manualVolumeMax}`)
      
      // Apply manual scaling to volume series using autoscaleInfoProvider
      volumeSeries.applyOptions({
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: manualVolumeMin, maxValue: manualVolumeMax },
        }),
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
        
        chart.priceScale('left').applyOptions({
          visible: true,
          borderVisible: true,
          entireTextOnly: false,
          scaleMargins: {
            top: 0.1,
            bottom: 0.1,
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
    lineSeriesRef.current = lineSeries

    // Resize handling with proper padding calculation
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        // Update width accounting for padding (60px left + 60px right = 120px total)
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth - 120,
        })
      }
    }

    // Use passive event listener to not interfere with other components
    window.addEventListener('resize', handleResize, { passive: true })

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
                USD
              </span>
            )}
          </h3>
          <div className="text-sm text-gray-400">
            {data.length} candles • 4h interval
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
        
        {/* Time Range Buttons */}
        <div className="flex flex-col gap-2">
          <div className="text-sm text-gray-400 mb-1">Time Range</div>
          <div className="flex gap-1">
            {['Max', '1Y', '3M', '1M', '1W'].map((range) => (
              <button
                key={range}
                onClick={() => setSelectedTimeRange(range)}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  selectedTimeRange === range
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
          <div className="text-xs text-gray-500">
            4-hour candles
          </div>
        </div>
      </div>
      <div className="relative w-full max-w-xs sm:max-w-sm md:max-w-xl lg:max-w-xl xl:max-w-4xl 2xl:max-w-7xl mx-auto">
        <div ref={chartContainerRef} className="w-full px-4 sm:px-8 lg:px-16" />
        {/* Y-axis labels */}
        <div className="absolute left-2 top-1/2 transform -translate-y-1/2 -rotate-90 text-xs text-gray-400 font-medium whitespace-nowrap">
          Volume (USD)
        </div>
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 -rotate-90 text-xs text-gray-400 font-medium whitespace-nowrap">
          Price (USD)
        </div>
      </div>
    </div>
  )
}

export default CryptoChart