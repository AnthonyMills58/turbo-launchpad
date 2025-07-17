export type CreatedTokenInfo = {
    chainId: number
    symbol: string
    othersHoldRaw: string          // totalSupply - creatorLockAmount (as raw string, 18 decimals)
    contractEthBalance: string     // strictly from address(this).balance
}

export type HeldTokenInfo = {
    chainId: number // 🔹 NEW
    symbol: string
    balanceRaw: string
    tokensValueEth: string
}

export interface PortfolioData {
  updated: boolean                // true = values were recalculated
  totalValueEth: string           // Sum of created + held token values (in ETH)
  createdTokens: CreatedTokenInfo[]
  heldTokens: HeldTokenInfo[]
}
