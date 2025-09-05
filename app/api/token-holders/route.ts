import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import db from '@/lib/db'
import TurboTokenABI from '@/lib/abi/TurboToken.json'
import { megaethMainnet, megaethTestnet, sepoliaTestnet } from '@/lib/chains'

// RPC URLs per chain
const rpcUrlsByChainId: Record<number, string> = {
  6342: megaethTestnet.rpcUrls.default.http[0],
  9999: megaethMainnet.rpcUrls.default.http[0],
  11155111: sepoliaTestnet.rpcUrls.default.http[0],
}

// Provider cache
const providerCache: Map<number, ethers.JsonRpcProvider> = new Map()

function getProvider(chainId: number): ethers.JsonRpcProvider {
  const cached = providerCache.get(chainId)
  if (cached) return cached

  const url = rpcUrlsByChainId[chainId]
  if (!url) throw new Error(`Unsupported chainId ${chainId}`)

  const network = { chainId, name: `chain-${chainId}` }
  const provider = new ethers.JsonRpcProvider(url, network)
  providerCache.set(chainId, provider)
  return provider
}

// Get all Transfer events to track token movements and holders
async function getTokenHolders(contractAddress: string, chainId: number): Promise<Set<string>> {
  const provider = getProvider(chainId)
  const contract = new ethers.Contract(contractAddress, TurboTokenABI.abi, provider)
  
  const holders = new Set<string>()
  
  try {
    // Get current block number first
    const currentBlock = await provider.getBlockNumber()
    console.log(`📊 Current block: ${currentBlock}`)
    
    // Query in chunks to avoid "max block range" error
    const maxBlockRange = 50000 // Conservative limit
    const filter = contract.filters.Transfer()
    const allEvents: ethers.EventLog[] = []
    
    // Query from recent blocks first (most likely to have current holders)
    let fromBlock = Math.max(0, currentBlock - maxBlockRange)
    let toBlock = currentBlock
    
    console.log(`🔍 Querying blocks ${fromBlock} to ${toBlock} (${toBlock - fromBlock} blocks)`)
    const initialRecentEvents = await contract.queryFilter(filter, fromBlock, toBlock)
    const validRecentEvents = initialRecentEvents.filter((event): event is ethers.EventLog => 'args' in event && event.args !== undefined)
    allEvents.push(...validRecentEvents)
    console.log(`📋 Found ${validRecentEvents.length} Transfer events in recent blocks`)
    
    // If we need to go further back, query in chunks
    while (fromBlock > 0) {
      toBlock = fromBlock - 1
      fromBlock = Math.max(0, toBlock - maxBlockRange)
      
      if (fromBlock <= toBlock) {
        console.log(`🔍 Querying blocks ${fromBlock} to ${toBlock} (${toBlock - fromBlock} blocks)`)
        try {
          const chunkEvents = await contract.queryFilter(filter, fromBlock, toBlock)
          const validChunkEvents = chunkEvents.filter((event): event is ethers.EventLog => 'args' in event && event.args !== undefined)
          allEvents.push(...validChunkEvents)
          console.log(`📋 Found ${validChunkEvents.length} Transfer events in this chunk`)
        } catch (chunkError) {
          console.warn(`⚠️ Failed to query chunk ${fromBlock}-${toBlock}:`, chunkError)
          break // Stop if we hit an error
        }
      }
    }
    
    console.log(`📋 Total Transfer events found: ${allEvents.length}`)
    const events = allEvents
    
    // Process all transfer events to track current holders
    for (const event of events) {
      if ('args' in event && event.args) {
        const { from, to } = event.args
        
        // Remove from set if balance becomes 0
        if (from && from !== ethers.ZeroAddress) {
          const fromBalance = await contract.balanceOf(from)
          if (fromBalance === 0n) {
            holders.delete(from.toLowerCase())
          } else {
            holders.add(from.toLowerCase())
          }
        }
        
        // Add to set if balance > 0
        if (to && to !== ethers.ZeroAddress) {
          const toBalance = await contract.balanceOf(to)
          if (toBalance > 0n) {
            holders.add(to.toLowerCase())
          }
        }
      }
    }
    
    // Also check current balances for addresses that might have received tokens
    // but haven't had any recent transfers
    const additionalCurrentBlock = await provider.getBlockNumber()
    const additionalRecentEvents = await contract.queryFilter(filter, Math.max(0, additionalCurrentBlock - 10000), 'latest')
    
    for (const event of additionalRecentEvents) {
      if ('args' in event && event.args) {
        const { to } = event.args
        if (to && to !== ethers.ZeroAddress) {
          const balance = await contract.balanceOf(to)
          if (balance > 0n) {
            holders.add(to.toLowerCase())
          }
        }
      }
    }
    
  } catch (error) {
    console.error('Error getting token holders:', error)
    // Fallback: try to get holders from recent events only
    try {
      const fallbackCurrentBlock = await provider.getBlockNumber()
      const fallbackFilter = contract.filters.Transfer()
      const fallbackRecentEvents = await contract.queryFilter(fallbackFilter, Math.max(0, fallbackCurrentBlock - 5000), 'latest')
      
      for (const event of fallbackRecentEvents) {
        if ('args' in event && event.args) {
          const { to } = event.args
          if (to && to !== ethers.ZeroAddress) {
            const balance = await contract.balanceOf(to)
            if (balance > 0n) {
              holders.add(to.toLowerCase())
            }
          }
        }
      }
      return holders
    } catch (fallbackError) {
      console.error('Fallback holder check failed:', fallbackError)
    }
  }
  
  console.log(`✅ Final holder count: ${holders.size} unique addresses`)
  return holders
}


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tokenId = searchParams.get('tokenId')
  const contractAddress = searchParams.get('contractAddress')
  const chainId = searchParams.get('chainId')
  
  try {
    
    if (!tokenId || !contractAddress || !chainId) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }
    
    const chainIdNum = parseInt(chainId)
    if (!rpcUrlsByChainId[chainIdNum]) {
      return NextResponse.json({ error: 'Unsupported chain' }, { status: 400 })
    }
    
    // Check if we have cached holder count in database
    const cachedResult = await db.query(
      'SELECT holder_count, holder_count_updated_at FROM tokens WHERE id = $1',
      [tokenId]
    )
    
    if (cachedResult.rows.length > 0) {
      const { holder_count, holder_count_updated_at } = cachedResult.rows[0]
      
      // If cached data is less than 5 minutes old, return it
      if (holder_count !== null && holder_count_updated_at) {
        const cacheAge = Date.now() - new Date(holder_count_updated_at).getTime()
        if (cacheAge < 5 * 60 * 1000) { // 5 minutes
          return NextResponse.json({ 
            holderCount: holder_count,
            cached: true,
            lastUpdated: holder_count_updated_at
          })
        }
      }
      
      // Get fresh holder count from blockchain
      console.log(`🔍 Fetching holders for token ${tokenId} at ${contractAddress} on chain ${chainIdNum}`)
      const holders = await getTokenHolders(contractAddress, chainIdNum)
      const holderCount = holders.size
      console.log(`📊 Found ${holderCount} holders for token ${tokenId}`)
      
      // Update database with new holder count
      const updateResult = await db.query(
        'UPDATE tokens SET holder_count = $1, holder_count_updated_at = NOW() WHERE id = $2',
        [holderCount, tokenId]
      )
      console.log(`💾 Updated database for token ${tokenId}: ${updateResult.rowCount} rows affected`)
      
      return NextResponse.json({ 
        holderCount,
        cached: false,
        lastUpdated: new Date().toISOString()
      })
    }
    
    return NextResponse.json({ error: 'Token not found' }, { status: 404 })
    
  } catch (error) {
    console.error('Token holders API error:', error)
    console.error('Error details:', {
      tokenId,
      contractAddress,
      chainId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
