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
  console.log('[syncDexState] Function called for token:', token.symbol, 'chain:', chainId)
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

    // === Always ensure dex_pools record exists when DEX pair is found ===
    try {
      // First check if record already exists
      const { rows: existingRows } = await db.query(`
        SELECT token_id FROM public.dex_pools WHERE token_id = $1 AND chain_id = $2
      `, [token.id, chainId])
      
      if (existingRows.length === 0) {
        // Record doesn't exist, insert it
        // Get current block and set smart buffer based on chain type
        const currentBlock = await provider.getBlockNumber()
        const bufferBlocks = chainId === 6342 ? 1000 : 5000  // MegaETH: 25min, Others: 18hrs
        const estimatedDeploymentBlock = Math.max(token.deployment_block || 0, currentBlock - bufferBlocks)
        
        const dexPoolsResult = await db.query(`
          INSERT INTO public.dex_pools (token_id, chain_id, pair_address, token0, token1, quote_token, deployment_block, last_processed_block, token_decimals, weth_decimals, quote_decimals)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [token.id, chainId, pairAddress, token.contract_address, wethAddress, wethAddress, estimatedDeploymentBlock, estimatedDeploymentBlock, 18, 18, 18])
        
        console.log(`[syncDexState] ✅ Added new dex_pools record, rowCount: ${dexPoolsResult.rowCount}, deployment_block: ${estimatedDeploymentBlock} (buffer: ${bufferBlocks} blocks)`)
      } else {
        // Record exists, update pair_address if needed
        const updateResult = await db.query(`
          UPDATE public.dex_pools 
          SET pair_address = $1 
          WHERE token_id = $2 AND chain_id = $3
        `, [pairAddress, token.id, chainId])
        
        console.log('[syncDexState] ✅ Updated existing dex_pools record, rowCount:', updateResult.rowCount)
      }
    } catch (dexPoolsError) {
      console.error('[syncDexState] Error ensuring dex_pools record:', dexPoolsError)
    }

    // === Mark token as on DEX and save DEX URL ===
    if (!token.on_dex && chain.dexBaseUrl) {
      const dexUrl = chain.id === 6342
        ? `${chain.dexBaseUrl}/${token.contract_address}/${pairAddress}`
        : `${chain.dexBaseUrl}/${pairAddress}`

      console.log('[syncDexState] Marking token as on DEX:', dexUrl)

      // Update database directly instead of calling API endpoint
      try {
        const result = await db.query(
          `UPDATE tokens
           SET on_dex = true,
               is_graduated = true,
               dex_listing_url = $1
           WHERE contract_address = $2`,
          [dexUrl, token.contract_address]
        )

        if (result.rowCount === 0) {
          console.warn('[syncDexState] Token not found in database')
        } else {
          console.log('[syncDexState] ✅ Updated token on_dex status')
        }
      } catch (error) {
        console.error('[syncDexState] Error updating token status:', error)
      }

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

      // Update price directly in database instead of calling API endpoint
      try {
        const priceResult = await db.query(
          `UPDATE tokens
           SET current_price = $1,
               fdv = $2,
               market_cap = $3,
               last_synced_at = NOW()
           WHERE contract_address = $4`,
          [price.toString(), fdv.toString(), marketCap.toString(), token.contract_address]
        )

        if (priceResult.rowCount === 0) {
          console.warn('[syncDexState] Token not found for price update:', token.contract_address)
        } else {
          console.log('[syncDexState] ✅ Updated token price, FDV, and market cap')
        }
      } catch (priceError) {
        console.error('[syncDexState] Error updating token price:', priceError)
      }
    }
  } catch (err) {
    console.error('[syncDexState] Error:', err)
  }
}









