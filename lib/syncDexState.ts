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
    if (!token.contract_address) return

    const chain = chainsById[chainId]
    if (!chain) return

    const provider = new ethers.JsonRpcProvider(chain.rpcUrls.default.http[0])
    const routerAddress = DEX_ROUTER_BY_CHAIN[chainId]
    const router = new ethers.Contract(routerAddress, routerAbi, provider)

    const factoryAddress = await router.factory()
    const wethAddress = await router.WETH()
    const factory = new ethers.Contract(factoryAddress, factoryAbi, provider)
    const pairAddress = await factory.getPair(token.contract_address, wethAddress)

    if (!pairAddress || pairAddress === ethers.ZeroAddress) return

    let isNowOnDex = token.on_dex

    // === If not yet listed, mark token as on DEX and save link ===
    if (!token.on_dex && chain.dexBaseUrl) {
      const dexUrl = chain.id === 6342
        ? `${chain.dexBaseUrl}/${token.contract_address}/${pairAddress}`
        : `${chain.dexBaseUrl}/${pairAddress}`

      await fetch('/api/mark-dex-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: token.contract_address,
          dexUrl,
        }),
      })

      isNowOnDex = true
      onRefresh()
    }

    // === If listed, fetch on-chain reserves and sync price ===
    if (isNowOnDex) {
      const pair = new ethers.Contract(pairAddress, pairAbi, provider)
      const [reserve0, reserve1] = await pair.getReserves()
      const token0 = await pair.token0()

      const isToken0 = token0.toLowerCase() === token.contract_address.toLowerCase()
      const reserveToken = isToken0 ? reserve0 : reserve1
      const reserveETH = isToken0 ? reserve1 : reserve0

      const tokenAmount = Number(ethers.formatUnits(reserveToken, 18))
      const ethAmount = Number(ethers.formatUnits(reserveETH, 18))

      if (tokenAmount === 0) return

      const price = ethAmount / tokenAmount

      const tokenContract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, provider)
      const totalSupply = await tokenContract.totalSupply()
      const locked = await tokenContract.lockedBalances(token.creator_wallet)
      const circulatingSupply = totalSupply - locked

      const fdv = price * Number(ethers.formatUnits(totalSupply, 18))
      const marketCap = price * Number(ethers.formatUnits(circulatingSupply, 18))

      await fetch('/api/dex-update-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: token.contract_address,
          dexPrice: price.toString(),
          fdv: fdv.toString(),
          marketCap: marketCap.toString(),
        }),
      })
    }
  } catch (err) {
    console.error('[syncDexState] Error:', err)
  }
}


