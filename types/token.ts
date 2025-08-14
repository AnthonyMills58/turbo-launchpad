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
  dex?: string
  on_dex?: boolean
  dex_listing_url?: string

  // Synced on-chain data (from DB)
  current_price?: number
  fdv?: number
  market_cap?: number
  total_supply?: number
  creator_lock_amount?: number
  airdrop_finalized?: boolean
  airdrop_allocations?: Record<string, number>
  airdrop_allocations_sum: number
  chain_id?: number

  // basePrice and slope (from db)
  base_price: number
  slope: number

  created_at?: string 
  // ✅ Cooldown (store seconds, not days)
  min_token_age_for_unlock_seconds: number
  // Optional helpers for UI
  unlock_at?: string            // server-computed: created_at + seconds
  creator_unlock_time?: number  // if read from contract (unix seconds)

  
}


