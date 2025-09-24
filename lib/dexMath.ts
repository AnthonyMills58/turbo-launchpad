import { ethers } from 'ethers'
import { pairAbi } from './dex'

// BigInt-safe helpers for DEX calculations
export const FEE_NUM = 997n;   // 0.30% fee -> 1000 - 3
export const FEE_DEN = 1000n;

export function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeNum: bigint = FEE_NUM,
  feeDen: bigint = FEE_DEN
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * feeNum / feeDen;
  return (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee); // floor
}

export function getAmountIn(
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeNum: bigint = FEE_NUM,
  feeDen: bigint = FEE_DEN
): bigint {
  if (amountOut <= 0n || reserveIn <= 0n || reserveOut <= 0n || amountOut >= reserveOut) {
    throw new Error('Invalid amounts/reserves');
  }
  const num = reserveIn * amountOut * feeDen;
  const den = (reserveOut - amountOut) * feeNum;
  // ceil division
  return (num + den - 1n) / den;
}

export function withSlippageMin(amount: bigint, slippageBps: number): bigint {
  return amount * BigInt(10_000 - slippageBps) / 10_000n; // floor
}

export function withSlippageMax(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10_000 + slippageBps) + 10_000n - 1n) / 10_000n; // ceil
}

// Optional: compute price impact (as basis points) for exact-in
export function priceImpactBps(
  amountIn: bigint,
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): number {
  // P_mid = reserveOut/reserveIn ; P_exec = amountOut/amountIn
  // impact = 1 - P_exec/P_mid = 1 - (amountOut * reserveIn) / (amountIn * reserveOut)
  const num = amountOut * reserveIn;
  const den = amountIn * reserveOut;
  if (den === 0n) return 0;
  const ratioBps = Number((num * 10_000n) / den); // P_exec/P_mid in bps
  return Math.max(0, 10_000 - ratioBps);
}

/**
 * Get DEX pool reserves for a token (client-side version)
 */
export async function getDexPoolReserves(
  pairAddress: string,
  tokenAddress: string,
  provider: ethers.Provider
): Promise<{ reserveToken: bigint; reserveETH: bigint } | null> {
  try {
    // Get reserves from pair contract
    const pair = new ethers.Contract(pairAddress, pairAbi, provider)
    const [reserve0, reserve1] = await pair.getReserves()
    const onChainToken0: string = await pair.token0()
    
    // Determine which reserve is the token and which is its pair (WETH/ETH)
    const isToken0 = onChainToken0.toLowerCase() === tokenAddress.toLowerCase()
    const reserveToken = isToken0 ? reserve0 : reserve1
    const reserveETH = isToken0 ? reserve1 : reserve0
    
    return {
      reserveToken: BigInt(reserveToken.toString()),
      reserveETH: BigInt(reserveETH.toString())
    }
  } catch (error) {
    console.error('Error getting DEX pool reserves:', error)
    return null
  }
}

/**
 * Calculate amount of tokens to buy from ETH amount (for ETH buttons)
 */
export async function calculateAmountFromETH(
  ethAmount: number,
  pairAddress: string,
  tokenAddress: string,
  provider: ethers.Provider
): Promise<number> {
  try {
    const reserves = await getDexPoolReserves(pairAddress, tokenAddress, provider)
    if (!reserves) return 0

    const { reserveToken, reserveETH } = reserves
    const amountInETH = ethers.parseEther(ethAmount.toString())
    
    // Calculate tokens out using getAmountOut
    const tokensOut = getAmountOut(amountInETH, reserveETH, reserveToken)
    
    return parseFloat(ethers.formatEther(tokensOut))
  } catch (error) {
    console.error('Error calculating amount from ETH:', error)
    return 0
  }
}

/**
 * Calculate ETH cost for token amount (for total cost display)
 */
export async function calculateETHfromAmount(
  tokenAmount: number,
  pairAddress: string,
  tokenAddress: string,
  provider: ethers.Provider
): Promise<number> {
  try {
    const reserves = await getDexPoolReserves(pairAddress, tokenAddress, provider)
    if (!reserves) return 0

    const { reserveToken, reserveETH } = reserves
    const amountOutTokens = ethers.parseEther(tokenAmount.toString())
    
    // Calculate ETH in using getAmountIn
    const ethIn = getAmountIn(amountOutTokens, reserveETH, reserveToken)
    
    return parseFloat(ethers.formatEther(ethIn))
  } catch (error) {
    console.error('Error calculating ETH from amount:', error)
    return 0
  }
}

/**
 * Calculate ETH out for an exact token-in sell (preferred for quoting sells)
 */
export async function calculateETHOutFromTokens(
  tokenAmountIn: number,
  pairAddress: string,
  tokenAddress: string,
  provider: ethers.Provider
): Promise<number> {
  try {
    const reserves = await getDexPoolReserves(pairAddress, tokenAddress, provider)
    if (!reserves) return 0

    const { reserveToken, reserveETH } = reserves
    const amountInTokens = ethers.parseEther(tokenAmountIn.toString())

    // Exact-in: tokens in -> ETH out
    const ethOut = getAmountOut(amountInTokens, reserveToken, reserveETH)
    return parseFloat(ethers.formatEther(ethOut))
  } catch (error) {
    console.error('Error calculating ETH out from tokens:', error)
    return 0
  }
}
