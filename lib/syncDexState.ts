import { ethers } from 'ethers'
import { DEX_ROUTER_BY_CHAIN, routerAbi, factoryAbi, pairAbi } from './dex'
import TurboTokenABI from './abi/TurboToken.json'
import { Token } from '../types/token'
import { chainsById } from './chains'
import db from './db'

/**
 * Gets actual circulating supply by fetching balances from blockchain
 * Uses a more comprehensive approach to catch all holders
 */
async function getCirculatingSupplyFromBlockchain(
  contractAddress: string, 
  chainId: number,
  provider: ethers.JsonRpcProvider
): Promise<number> {
  const contract = new ethers.Contract(contractAddress, TurboTokenABI.abi, provider)
  
  // Method 1: Get addresses from database (known holders)
  const { rows: knownAddresses } = await db.query(
    `SELECT DISTINCT LOWER(holder) as holder
     FROM public.token_balances 
     WHERE token_id = (SELECT id FROM public.tokens WHERE contract_address = $1 AND chain_id = $2)
     UNION
     SELECT DISTINCT LOWER(trader) as holder
     FROM public.token_trades 
     WHERE token_id = (SELECT id FROM public.tokens WHERE contract_address = $1 AND chain_id = $2)
     UNION
     SELECT DISTINCT LOWER(from_address) as holder
     FROM public.token_transfers 
     WHERE token_id = (SELECT id FROM public.tokens WHERE contract_address = $1 AND chain_id = $2)
     UNION
     SELECT DISTINCT LOWER(to_address) as holder
     FROM public.token_transfers 
     WHERE token_id = (SELECT id FROM public.tokens WHERE contract_address = $1 AND chain_id = $2)`,
    [contractAddress, chainId]
  )

  // Method 2: Get recent transfer events to catch new addresses
  const currentBlock = await provider.getBlockNumber()
  const fromBlock = Math.max(currentBlock - 1000, 0) // Last ~1000 blocks
  
  const transferFilter = {
    address: contractAddress,
    topics: [
      ethers.id("Transfer(address,address,uint256)") // Transfer event signature
    ],
    fromBlock,
    toBlock: 'latest'
  }
  
  const recentTransfers = await provider.getLogs(transferFilter)
  
  // Extract unique addresses from recent transfers
  const recentAddresses = new Set<string>()
  for (const log of recentTransfers) {
    if (log.topics.length >= 3) {
      const from = ethers.getAddress('0x' + log.topics[1].slice(26))
      const to = ethers.getAddress('0x' + log.topics[2].slice(26))
      recentAddresses.add(from.toLowerCase())
      recentAddresses.add(to.toLowerCase())
    }
  }

  // Combine known addresses with recent addresses
  const allAddresses = new Set<string>()
  knownAddresses.forEach(({ holder }) => allAddresses.add(holder))
  recentAddresses.forEach(addr => allAddresses.add(addr))

  let totalCirculating = 0n
  let checkedAddresses = 0

  // Fetch current balance for each address from blockchain
  for (const holder of allAddresses) {
    try {
      const balance = await contract.balanceOf(holder)
      if (balance > 0n) {
        totalCirculating += balance
      }
      checkedAddresses++
      
      // Limit to prevent excessive RPC calls
      if (checkedAddresses > 100) {
        console.warn(`Reached limit of 100 addresses for ${contractAddress}, some may be missed`)
        break
      }
    } catch (error) {
      console.warn(`Failed to get balance for ${holder}:`, error)
    }
  }

  console.log(`Checked ${checkedAddresses} addresses for ${contractAddress}, total circulating: ${Number(totalCirculating) / 1e18}`)
  return Number(totalCirculating) / 1e18 // Convert wei to tokens
}

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
      
      // FDV: Use totalSupply (includes LP tokens after graduation)
      const fdv = price * Number(ethers.formatUnits(totalSupply, decimals))
      
      // Market Cap: Use actual circulating supply from blockchain (like worker logic)
      const circulatingSupply = await getCirculatingSupplyFromBlockchain(token.contract_address, chainId, provider)
      const marketCap = price * circulatingSupply

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









