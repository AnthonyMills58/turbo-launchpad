export type Token = {
  id: number
  name: string
  symbol: string
  description: string
  image: string
  website?: string
  twitter?: string
  telegram?: string
  contract_address: string
  creator_wallet: string
  raise_target: number
  eth_raised: number
  supply: number
  is_graduated: boolean
  lockedAmount?: string // Only for creator
  // DEX deployment tracking
  on_dex?: boolean
  dex_listing_url?: string


  // Data from tokenInfo() in contract
  onChainData?: {
    raiseTarget: number
    totalRaised: number
    basePrice: number
    currentPrice: number
    graduated: boolean
    creatorLockAmount: number
    airdropFinalized: boolean
    totalSupply: number   // ✅ Added
  }
}

