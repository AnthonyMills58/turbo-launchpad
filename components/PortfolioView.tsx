'use client'

import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { PortfolioData } from '@/types/portfolio'
import { chainNamesById } from '@/lib/chains'
import { formatValue } from '@/lib/displayFormats'
import { getUsdPrice } from '@/lib/getUsdPrice'

export default function PortfolioView() {
  const { address, isConnected } = useAccount()
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null)
  const [loading, setLoading] = useState(true)
  const [ethPriceUsd, setEthPriceUsd] = useState<number | null>(null)

  useEffect(() => {
    if (!address) return

    const fetchPortfolio = async () => {
      try {
        setLoading(true)

        const [portfolioRes, usdPrice] = await Promise.all([
          fetch('/api/portfolio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet: address }),
          }),
          getUsdPrice(),
        ])

        console.log('[PortfolioView] getUsdPrice() returned:', usdPrice)

        if (!portfolioRes.ok) throw new Error(`API error: ${portfolioRes.status}`)
        const data: PortfolioData = await portfolioRes.json()
        setPortfolio(data)
        setEthPriceUsd(usdPrice)
      } catch (error) {
        console.error('Failed to fetch portfolio:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchPortfolio()
  }, [address])

  const renderTableHeaders = (balanceLabel: string) => (
    <thead>
      <tr className="border-b border-gray-600 text-left">
        <th className="py-2 px-2 w-1/8">Symbol</th>
        <th className="py-2 px-2 w-1/5">Chain</th>
        <th className="py-2 px-2 w-1/6">{balanceLabel}</th>
        <th className="py-2 px-2 w-1/6 text-right">ETH Value</th>
      </tr>
    </thead>
  )

  const formatEthWithUsd = (ethValue: number): string => {
    const ethFormatted = `${formatValue(ethValue)} ETH`
    if (ethPriceUsd && ethValue > 0) {
      const usd = ethValue * ethPriceUsd
      return `${ethFormatted} ($${formatValue(usd)})`
    }
    return ethFormatted
  }

  return (
    <div className="w-full flex justify-center">
      <div className="max-w-[580px] w-full bg-[#151827] p-6 rounded-lg shadow-lg">
        <h1 className="text-2xl mb-6 text-gray-300 text-center">Your Portfolio</h1>

        {!isConnected ? (
          <p className="text-center text-gray-300">Please connect your wallet to view your portfolio.</p>
        ) : loading ? (
          <p className="text-center text-gray-300">Loading portfolio...</p>
        ) : !portfolio ? (
          <p className="text-center text-red-400">Failed to load portfolio.</p>
        ) : (
          <>
            {/* Empty Portfolio Message */}
            {portfolio.createdTokens.length === 0 && portfolio.heldTokens.length === 0 && (
              <p className="text-center text-gray-400">
                You don’t have any tokens yet. Create a token or buy one to get started!
              </p>
            )}

            {/* Created Tokens Table */}
            {portfolio.createdTokens.length > 0 && (
              <div className="mb-8">
                <h2 className="text-green-600 mb-2">Your Tokens</h2>
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed text-sm text-gray-300">
                    {renderTableHeaders('Others Hold')}
                    <tbody>
                      {portfolio.createdTokens.map((token, i) => (
                        <tr key={`created-${i}`} className="border-b border-gray-700">
                          <td className="py-2 px-2 w-1/8">{token.symbol}</td>
                          <td className="py-2 px-2 w-1/5">{chainNamesById[token.chainId] || token.chainId}</td>
                          <td className="py-2 px-2 w-1/6">{Number(token.othersHoldRaw).toLocaleString()}</td>
                          <td className="py-2 px-2 w-1/6 text-right">
                            {formatEthWithUsd(Number(token.contractEthBalance))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Held Tokens Table */}
            {portfolio.heldTokens.length > 0 && (
              <div className="mb-4">
                <h2 className="text-green-600 mb-2">Held Tokens</h2>
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed text-sm text-gray-300">
                    {renderTableHeaders('You Hold')}
                    <tbody>
                      {portfolio.heldTokens.map((token, i) => (
                        <tr key={`held-${i}`} className="border-b border-gray-700">
                          <td className="py-2 px-2 w-1/8">{token.symbol}</td>
                          <td className="py-2 px-2 w-1/5">{chainNamesById[token.chainId] || token.chainId}</td>
                          <td className="py-2 px-2 w-1/6">{Number(token.balanceRaw).toLocaleString()}</td>
                          <td className="py-2 px-2 w-1/6 text-right">
                            {formatEthWithUsd(Number(token.tokensValueEth))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Total Summary */}
            {(portfolio.createdTokens.length > 0 || portfolio.heldTokens.length > 0) && (
              <div className="mt-2 text-right text-green-600 text-sm border-t border-gray-700 pt-3">
                {(() => {
                  const totalCreated = portfolio.createdTokens.reduce(
                    (sum, token) => sum + Number(token.contractEthBalance || 0),
                    0
                  )
                  const totalHeld = portfolio.heldTokens.reduce(
                    (sum, token) => sum + Number(token.tokensValueEth || 0),
                    0
                  )
                  const totalCombined = totalCreated + totalHeld
                  const totalUsd = ethPriceUsd ? totalCombined * ethPriceUsd : null
                  return (
                    <>
                      Total: {formatValue(totalCombined)} ETH
                      {totalUsd !== null && ` ($${formatValue(totalUsd)})`}
                    </>
                  )
                })()}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}









