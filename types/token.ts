export type Token = {
  id: number
  name: string
  symbol: string
  description: string
  image: string
  contract_address: string
  creator_wallet: string
  raise_target: number
  eth_raised: number
  supply: number
  is_graduated: boolean
  lockedAmount?: string // Only for creator

  // Dane z tokenInfo() w kontrakcie
  onChainData?: {
    raiseTarget: number
    totalRaised: number
    basePrice: number
    currentPrice: number
    graduated: boolean
    creatorLockAmount: number
  }
}
