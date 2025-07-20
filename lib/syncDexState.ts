import { ethers } from 'ethers'
import { DEX_ROUTER_BY_CHAIN, routerAbi, factoryAbi, pairAbi } from './dex'
import TurboTokenABI from './abi/TurboToken.json'
import { Token } from '../types/token'
import { chainsById } from './chains'

export async function syncDexState(
  token: Token,
  chainId: number,
  onRefresh: () => void
): Promise<void> {
  try {
    if (!token.contract_address) {
      console.warn('[syncDexState] Missing contract address')
      return
    }

    const chain = chainsById[chainId]
    if (!chain) {
      console.warn('[syncDexState] Unsupported chain ID:', chainId)
      return
    }

    const provider = new ethers.JsonRpcProvider(chain.rpcUrls.default.http[0])
    const routerAddress = DEX_ROUTER_BY_CHAIN[chainId]
    const router = new ethers.Contract(routerAddress, routerAbi, provider)

    const factoryAddress = await router.factory()
    const wethAddress = await router.WETH()
    const factory = new ethers.Contract(factoryAddress, factoryAbi, provider)
    const pairAddress = await factory.getPair(token.contract_address, wethAddress)

    if (!pairAddress || pairAddress === ethers.ZeroAddress) {
      console.warn('[syncDexState] No DEX pair found')
      return
    }

    let isNowOnDex = token.on_dex

    // === Mark token as on DEX and save DEX URL ===
    if (!token.on_dex && chain.dexBaseUrl) {
      const dexUrl = chain.id === 6342
        ? `${chain.dexBaseUrl}/${token.contract_address}/${pairAddress}`
        : `${chain.dexBaseUrl}/${pairAddress}`

      console.log('[syncDexState] Marking token as on DEX:', dexUrl)

      const res = await fetch('/api/mark-dex-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: token.contract_address,
          dexUrl,
        }),
      })

      const result = await res.json()
      console.log('[syncDexState] mark-dex-listing response:', result)

      isNowOnDex = true
      onRefresh()
    }

    // === Fetch reserves and calculate price ===
    if (isNowOnDex) {
      const pair = new ethers.Contract(pairAddress, pairAbi, provider)
      const [reserve0, reserve1] = await pair.getReserves()
      const token0 = await pair.token0()
      const token1 = await pair.token1()

      console.log('[syncDexState] token0:', token0)
      console.log('[syncDexState] token1:', token1)
      console.log('[syncDexState] contract:', token.contract_address)
      console.log('[syncDexState] reserve0:', reserve0.toString())
      console.log('[syncDexState] reserve1:', reserve1.toString())

      const isWeth0 = token0.toLowerCase() === wethAddress.toLowerCase()
      const reserveETH = isWeth0 ? reserve0 : reserve1
      const reserveToken = isWeth0 ? reserve1 : reserve0

     

      const tokenContract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, provider)
      const decimals = await tokenContract.decimals()
      console.log('[syncDexState] Token decimals from contract:', decimals)

      console.log('[syncDexState] Raw reserveToken:', reserveToken.toString())
      console.log('[syncDexState] Raw reserveETH:', reserveETH.toString())

      const tokenAmount = Number(ethers.formatUnits(reserveToken, decimals))
      const ethAmount = Number(ethers.formatUnits(reserveETH, 18))

      console.log('[syncDexState] Parsed tokenAmount:', tokenAmount)
      console.log('[syncDexState] Parsed ethAmount:', ethAmount)

      if (tokenAmount === 0) {
        console.warn('[syncDexState] Token reserve is 0 — skipping price update')
        return
      }

      const price = ethAmount / tokenAmount
      console.log('[syncDexState] ✅ Calculated DEX price (ETH/token):', price)

      const totalSupply = await tokenContract.totalSupply()
      const locked = await tokenContract.lockedBalances(token.creator_wallet)
      const circulatingSupply = totalSupply - locked

      const fdv = price * Number(ethers.formatUnits(totalSupply, decimals))
      const marketCap = price * Number(ethers.formatUnits(circulatingSupply, decimals))

      console.log('[syncDexState] FDV (ETH):', fdv)
      console.log('[syncDexState] Market Cap (ETH):', marketCap)

      const updateRes = await fetch('/api/dex-update-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: token.contract_address,
          dexPrice: price.toString(),
          fdv: fdv.toString(),
          marketCap: marketCap.toString(),
        }),
      })

      const updateResult = await updateRes.json()
      console.log('[syncDexState] dex-update-price response:', updateResult)
    }
  } catch (err) {
    console.error('[syncDexState] Error:', err)
  }
}









