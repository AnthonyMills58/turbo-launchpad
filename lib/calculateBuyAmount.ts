// Reverses bonding curve pricing formula to calculate token amount for a given ETH amount
// totalCost: total ETH user wants to spend (in ETH, as a string or number)
// totalSupply: current total supply of tokens (in tokens, not wei)
// basePrice: base price from the contract (as string or bigint in wei)
// slope: slope from the contract (as string or bigint in wei)

export function calculateBuyAmountFromCost(
  totalCostEth: number,
  totalSupplyWei: bigint,
  basePriceWei: bigint,
  slopeWei: bigint
): number {
  const costWei = BigInt(Math.floor(totalCostEth * 1e18))
  const s = slopeWei
  const b = basePriceWei
  const supply = totalSupplyWei

  const A = s
  const B = s * (2n * supply + 1_000_000_000_000_000_000n) + 2n * b * 1_000_000_000_000_000_000n
  const C = -2n * costWei * 1_000_000_000_000_000_000n

  const discriminant = B * B - 4n * A * C
  if (discriminant < 0n) throw new Error('Discriminant < 0')

  const sqrtDisc = bigintSqrt(discriminant)

  // ✅ Convert to number before division
  const rawNumerator = -B + sqrtDisc
  const rawDenominator = 2n * A
  const amountTokens = Number(rawNumerator) / Number(rawDenominator)

  if (amountTokens <= 0) throw new Error('Resulting amount is zero or negative.')

  console.log('🧪 amountTokens:', amountTokens)
  return amountTokens
}



function bigintSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error('sqrt only works on non-negative inputs')
  if (value < 2n) return value

  let x0 = value / 2n
  let x1 = (x0 + value / x0) / 2n

  while (x1 < x0) {
    x0 = x1
    x1 = (x0 + value / x0) / 2n
  }

  return x0
}



