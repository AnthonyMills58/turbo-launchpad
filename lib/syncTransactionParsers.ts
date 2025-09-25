import { ethers } from 'ethers'
import db from './db'
import { megaethTestnet, megaethMainnet, sepoliaTestnet } from './chains'
import { DEX_ROUTER_BY_CHAIN } from './dex'

// Event topics
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
const SYNC_TOPIC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1'



/**
 * Parse BC transfer (BUY/SELL/AIRDROP_CLAIM/UNLOCK)
 */
export async function parseBCTransfer(
  txHash: string,
  tokenId: number,
  chainId: number,
  operationType: string,
  ethPriceUsd: number
): Promise<void> {
  console.log(`[parseBCTransfer] Starting for token ${tokenId}, tx ${txHash}, operation ${operationType}`)
  
  // RPCs by chain (same as syncTokenState)
  const rpcUrlsByChainId: Record<number, string> = {
    6342: megaethTestnet.rpcUrls.default.http[0],
    9999: megaethMainnet.rpcUrls.default.http[0],
    11155111: sepoliaTestnet.rpcUrls.default.http[0],
  }
  
  console.log(`[parseBCTransfer] Creating provider for chain ${chainId}`)
  const provider = new ethers.JsonRpcProvider(rpcUrlsByChainId[chainId])
  
  try {
    console.log(`[parseBCTransfer] Getting transaction receipt for ${txHash}`)
    const receipt = await provider.getTransactionReceipt(txHash)
    if (!receipt) {
      throw new Error(`Could not get transaction receipt for ${txHash}`)
    }

    // Get block details
    const block = await provider.getBlock(receipt.blockNumber)
    if (!block) {
      throw new Error(`Could not get block ${receipt.blockNumber}`)
    }
    const blockTime = new Date(Number(block.timestamp) * 1000)

    // Filter transfer logs for this token
    const transferLogs = receipt.logs.filter(log => 
      log.topics[0] === TRANSFER_TOPIC
    )

    if (transferLogs.length === 0) {
      throw new Error(`No transfer logs found in transaction ${txHash}`)
    }

    // Get token contract address
    const { rows: tokenRows } = await db.query(
      'SELECT contract_address FROM public.tokens WHERE id = $1 AND chain_id = $2',
      [tokenId, chainId]
    )
    if (tokenRows.length === 0) {
      throw new Error(`Token ${tokenId} not found for chain ${chainId}`)
    }
    const contractAddress = tokenRows[0].contract_address

    // Filter logs for this specific token
    const tokenTransferLogs = transferLogs.filter(log => 
      log.address.toLowerCase() === contractAddress.toLowerCase()
    )

    if (tokenTransferLogs.length === 1) {
      // Simple transfer (BUY/SELL/AIRDROP_CLAIM/UNLOCK)
      await parseSimpleTransfer(
        tokenId, chainId, contractAddress, receipt, tokenTransferLogs[0], 
        blockTime, operationType, provider, ethPriceUsd
      )
    } else if (tokenTransferLogs.length >= 3) {
      // Graduation (multiple transfers)
      await parseGraduationTransfers(
        tokenId, chainId, contractAddress, receipt, tokenTransferLogs,
        blockTime, provider, ethPriceUsd
      )
    } else {
      throw new Error(`Unexpected number of transfer logs: ${tokenTransferLogs.length}`)
    }

  } catch (error) {
    console.error(`Error parsing BC transfer for token ${tokenId}:`, error)
    throw error
  }
}

/**
 * Parse simple transfer (BUY/SELL/AIRDROP_CLAIM/UNLOCK)
 */
async function parseSimpleTransfer(
  tokenId: number,
  chainId: number,
  contractAddress: string,
  receipt: ethers.TransactionReceipt,
  log: ethers.Log,
  blockTime: Date,
  operationType: string,
  provider: ethers.JsonRpcProvider,
  ethPriceUsd: number
): Promise<void> {
  // Decode transfer log
  const fromAddress = ethers.getAddress('0x' + log.topics[1].slice(26))
  const toAddress = ethers.getAddress('0x' + log.topics[2].slice(26))
  const amount = BigInt(log.data)

  // Determine side and src based on operation type
  let side: string
  const src = 'BC'
  let ethAmount = 0n
  let priceEthPerToken = 0

  switch (operationType) {
    case 'BC_BUY':
      side = 'BUY'
      // Get transaction value for ETH amount
      const tx = await provider.getTransaction(receipt.hash)
      ethAmount = tx?.value || 0n
      priceEthPerToken = ethAmount > 0n && amount > 0n ? Number(ethAmount) / Number(amount) : 0
      break
    case 'BC_BUY&LOCK':
      side = 'BUY&LOCK'
      // Get transaction value for ETH amount
      const txLock = await provider.getTransaction(receipt.hash)
      ethAmount = txLock?.value || 0n
      priceEthPerToken = ethAmount > 0n && amount > 0n ? Number(ethAmount) / Number(amount) : 0
      break
    case 'BC_SELL':
      side = 'SELL'
      // For SELL, calculate the ETH amount received by calling getSellPrice
      // Use block before transaction to get the correct price (like worker)
      try {
        const blockBeforeTx = receipt.blockNumber - 1
        
        const turboTokenInterface = new ethers.Interface([
          'function getSellPrice(uint256 tokenAmount) view returns (uint256)'
        ])
        
        const sellPriceWei = await provider.call({
          to: contractAddress,
          data: turboTokenInterface.encodeFunctionData('getSellPrice', [amount]),
          blockTag: blockBeforeTx
        })
        
        if (sellPriceWei && sellPriceWei !== '0x') {
          ethAmount = BigInt(sellPriceWei.toString())
          if (ethAmount > 0n && amount > 0n) {
            priceEthPerToken = Number(ethAmount) / Number(amount)
          }
        }
      } catch (error) {
        console.warn(`Could not get SELL price for token ${tokenId}: ${error}`)
      }
      break
    case 'BC_AIRDROP_CLAIM':
      side = 'CLAIMAIRDROP'
      break
    case 'BC_UNLOCK':
      side = 'UNLOCK'
      break
    default:
      side = 'TRANSFER'
  }

  // Insert transfer record
  await db.query(`
    INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, eth_price_usd)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (chain_id, tx_hash, log_index) DO UPDATE SET
      side = EXCLUDED.side,
      src = EXCLUDED.src,
      eth_price_usd = EXCLUDED.eth_price_usd,
      amount_wei = EXCLUDED.amount_wei,
      amount_eth_wei = EXCLUDED.amount_eth_wei,
      price_eth_per_token = EXCLUDED.price_eth_per_token
  `, [
    tokenId, chainId, contractAddress, log.blockNumber, blockTime, log.transactionHash,
    log.index, fromAddress, toAddress, amount.toString(), ethAmount.toString(), 
    priceEthPerToken, side, src, ethPriceUsd
  ])

  console.log(`✅ Parsed simple ${side} transfer for token ${tokenId}`)
}

/**
 * Parse graduation transfers (MINT + BUY + GRADUATION)
 */
async function parseGraduationTransfers(
  tokenId: number,
  chainId: number,
  contractAddress: string,
  receipt: ethers.TransactionReceipt,
  transferLogs: ethers.Log[],
  blockTime: Date,
  provider: ethers.JsonRpcProvider,
  ethPriceUsd: number
): Promise<void> {
  // Proper graduation handling: insert three ordered records (MINT, BUY, GRADUATION)
  // 1) Detect specific transfer logs
  //    - userBuyLog: zero address -> user
  //    - graduationLog: zero address -> contract (mint to contract)
  //    - lpTransferLog (optional): contract -> pair (LP add)

  const zeroAddress = '0x0000000000000000000000000000000000000000'

  const decodeAddress = (topic: string) => ethers.getAddress('0x' + topic.slice(26))

  let userBuyLog: ethers.Log | undefined
  let graduationLog: ethers.Log | undefined
  let lpTransferLog: ethers.Log | undefined

  for (const log of transferLogs) {
    const from = decodeAddress(log.topics[1])
    const to = decodeAddress(log.topics[2])
    if (from.toLowerCase() === zeroAddress && to.toLowerCase() !== zeroAddress && to.toLowerCase() !== contractAddress.toLowerCase()) {
      // Mint to user (BUY)
      userBuyLog = log
    } else if (from.toLowerCase() === zeroAddress && to.toLowerCase() === contractAddress.toLowerCase()) {
      // Mint to contract (GRADUATION MINT)
      graduationLog = log
    } else if (from.toLowerCase() === contractAddress.toLowerCase()) {
      // Contract sent tokens (likely to LP pair)
      lpTransferLog = log
    }
  }

  if (!userBuyLog || !graduationLog) {
    console.error(`Graduation detection failed for token ${tokenId}: missing userBuyLog or graduationLog`)
    return
  }

  const userAmount = BigInt(userBuyLog.data)
  const graduationAmount = BigInt(graduationLog.data)
  const userToAddress = decodeAddress(userBuyLog.topics[2])

  // Fetch tx for ETH value
  const tx = await provider.getTransaction(receipt.hash)
  const userEthAmount = tx?.value ?? 0n

  // Use graduationAmount for token amount (addLiquidity token amount)
  const liquidityTokenAmount = graduationAmount
  
  // Try to find WETH transfer to LP pair for addLiquidity ETH amount
  let liquidityEthAmount: bigint = userEthAmount // Fallback to user ETH amount
  
  // Find WETH Transfer event FROM the bonding curve TO a different address (addLiquidity)
  // Look for transfers with small amounts (WETH amounts are typically small decimals)
  const transferIface = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)'])
  const transferTopic = transferIface.getEvent('Transfer')!.topicHash
  
  const wethTransferLog = receipt.logs.find(log => {
    if (log.topics[0] !== transferTopic) return false
    
    try {
      const decoded = transferIface.parseLog({ topics: log.topics, data: log.data })
      if (decoded) {
        const fromAddress = decoded.args.from.toLowerCase()
        const toAddress = decoded.args.to.toLowerCase()
        const transferAmount = BigInt(decoded.args.value.toString())
        
        // Find transfer FROM router address TO a different address with small amount (likely WETH)
        // The addLiquidity WETH transfer comes from the router, not the bonding curve
        const routerAddress = DEX_ROUTER_BY_CHAIN[chainId]
        const isFromRouter = fromAddress === routerAddress.toLowerCase()
        const isToDifferentAddress = toAddress !== contractAddress.toLowerCase()
        const isSmallAmount = transferAmount < 1000000000000000000n // Less than 1 ETH in wei
        const isNotUserBuyAmount = transferAmount !== userEthAmount // Exclude user's buy amount
        
        return isFromRouter && isToDifferentAddress && isSmallAmount && isNotUserBuyAmount
      }
    } catch {
      return false
    }
    return false
  })
  
  if (wethTransferLog) {
    const decoded = transferIface.parseLog({ topics: wethTransferLog.topics, data: wethTransferLog.data })
    if (decoded) {
      liquidityEthAmount = BigInt(decoded.args.value.toString())
    }
  }

  // Compute prices
  const userPriceEthPerToken = userEthAmount > 0n && userAmount > 0n ? Number(userEthAmount) / Number(userAmount) : 0
  const graduationPriceEthPerToken = liquidityEthAmount > 0n && liquidityTokenAmount > 0n ? Number(liquidityEthAmount) / Number(liquidityTokenAmount) : 0

  // Insert three records with artificial ordering around userBuyLog.index
  const run = async (query: string, params: unknown[]) => db.query(query, params)
  try {

    // Record 1: MINT (index = userBuyLog.index - 1)
    await run(`
      INSERT INTO public.token_transfers
        (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, graduation_metadata, eth_price_usd)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING
    `, [
      tokenId, chainId, contractAddress, receipt.blockNumber, blockTime, receipt.hash,
      (userBuyLog.index as number) - 1,
      zeroAddress,
      contractAddress,
      graduationAmount.toString(),
      '0',
      0,
      'MINT',
      'BC',
      JSON.stringify({ type: 'graduation', phase: 'mint' }),
      ethPriceUsd
    ])

    // Record 2: BUY (index = userBuyLog.index)
    await run(`
      INSERT INTO public.token_transfers
        (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, eth_price_usd)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING
    `, [
      tokenId, chainId, contractAddress, receipt.blockNumber, blockTime, receipt.hash,
      userBuyLog.index as number,
      zeroAddress,
      userToAddress,
      userAmount.toString(),
      userEthAmount.toString(),
      userPriceEthPerToken,
      'BUY',
      'BC',
      ethPriceUsd
    ])

    // Record 3: GRADUATION summary (index = userBuyLog.index + 1)
    await run(`
      INSERT INTO public.token_transfers
        (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, graduation_metadata, eth_price_usd)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING
    `, [
      tokenId, chainId, contractAddress, receipt.blockNumber, blockTime, receipt.hash,
      graduationLog.index as number,
      contractAddress,
      (lpTransferLog ? decodeAddress(lpTransferLog.topics[2]) : zeroAddress),
      liquidityTokenAmount.toString(),
      liquidityEthAmount.toString(),
      graduationPriceEthPerToken,
      'GRADUATION',
      'BC',
      JSON.stringify({ type: 'graduation', phase: 'summary' }),
      ethPriceUsd
    ])

  } catch (e) {
    throw e
  }
}

/**
 * Parse DEX swap (BUY/SELL)
 */
export async function parseDEXSwap(
  txHash: string,
  tokenId: number,
  chainId: number,
  operationType: string,
  ethPriceUsd: number
): Promise<void> {
  // RPCs by chain (same as syncTokenState)
  const rpcUrlsByChainId: Record<number, string> = {
    6342: megaethTestnet.rpcUrls.default.http[0],
    9999: megaethMainnet.rpcUrls.default.http[0],
    11155111: sepoliaTestnet.rpcUrls.default.http[0],
  }
  
  const provider = new ethers.JsonRpcProvider(rpcUrlsByChainId[chainId])
  
  try {
    const receipt = await provider.getTransactionReceipt(txHash)
    if (!receipt) {
      throw new Error(`Could not get transaction receipt for ${txHash}`)
    }

    // Get block details
    const block = await provider.getBlock(receipt.blockNumber)
    if (!block) {
      throw new Error(`Could not get block ${receipt.blockNumber}`)
    }
    const blockTime = new Date(Number(block.timestamp) * 1000)

    // Get DEX pool info
    const { rows: dexPoolRows } = await db.query(`
      SELECT pair_address, token0, token1, quote_token, token_decimals, quote_decimals
      FROM public.dex_pools 
      WHERE token_id = $1 AND chain_id = $2
    `, [tokenId, chainId])
    
    if (dexPoolRows.length === 0) {
      throw new Error(`No DEX pool found for token ${tokenId} on chain ${chainId}`)
    }
    const dexPool = dexPoolRows[0]

    // Find swap and sync logs
    const swapLog = receipt.logs.find(log => 
      log.address.toLowerCase() === dexPool.pair_address.toLowerCase() &&
      log.topics[0] === SWAP_TOPIC
    )
    
    const syncLog = receipt.logs.find(log => 
      log.address.toLowerCase() === dexPool.pair_address.toLowerCase() &&
      log.topics[0] === SYNC_TOPIC
    )

    if (!swapLog) {
      throw new Error(`No swap log found in transaction ${txHash}`)
    }

    if (!syncLog) {
      throw new Error(`No sync log found in transaction ${txHash}`)
    }

    // Parse swap log
    await parseSwapLog(tokenId, chainId, receipt, swapLog, blockTime, operationType, provider, ethPriceUsd)
    
    // Parse sync log
    await parseSyncLog(tokenId, chainId, syncLog, blockTime, dexPool, provider)

  } catch (error) {
    console.error(`Error parsing DEX swap for token ${tokenId}:`, error)
    throw error
  }
}

/**
 * Parse swap log and insert into token_transfers
 */
async function parseSwapLog(
  tokenId: number,
  chainId: number,
  receipt: ethers.TransactionReceipt,
  log: ethers.Log,
  blockTime: Date,
  operationType: string,
  provider: ethers.JsonRpcProvider,
  ethPriceUsd: number
): Promise<void> {
  // Decode swap log
  const [amount0In, amount1In, amount0Out, amount1Out] = ethers.AbiCoder.defaultAbiCoder().decode(
    ['uint256', 'uint256', 'uint256', 'uint256'],
    log.data
  )
  
  const to = ethers.getAddress('0x' + log.topics[2].slice(26))

  // Get transaction details
  const tx = await provider.getTransaction(receipt.hash)
  if (!tx) {
    throw new Error(`Could not get transaction ${receipt.hash}`)
  }

  // Get token contract address (single query)
  const { rows: tokenRows } = await db.query(`
    SELECT contract_address FROM public.tokens WHERE id = $1 AND chain_id = $2
  `, [tokenId, chainId])
  
  if (tokenRows.length === 0) {
    throw new Error(`Token ${tokenId} not found for chain ${chainId}`)
  }
  
  const tokenContractAddress = tokenRows[0].contract_address
  
  // Get actual token addresses from the DEX pair contract to determine correct mapping
  const pairContract = new ethers.Contract(log.address, [
    'function token0() view returns (address)',
    'function token1() view returns (address)'
  ], provider)
  
  const actualToken0 = await pairContract.token0()
  
  // Get WETH address from database (quote_token is always WETH)
  const { rows: dexPoolRows } = await db.query(`
    SELECT quote_token FROM public.dex_pools WHERE pair_address = $1 AND chain_id = $2
  `, [log.address, chainId])
  
  if (dexPoolRows.length === 0) {
    throw new Error(`DEX pool not found for pair ${log.address} on chain ${chainId}`)
  }
  
  const wethAddress = dexPoolRows[0].quote_token
  
  // Determine which amount corresponds to which token
  const isWethToken0 = actualToken0.toLowerCase() === wethAddress.toLowerCase()
  
  // Determine if this is a BUY or SELL based on actual token order (EXACT worker logic)
  let isBuy: boolean
  if (isWethToken0) {
    // WETH is token0, our token is token1
    // BUY: amount1Out > 0 (receiving our token)
    // SELL: amount1In > 0 (selling our token)
    isBuy = amount1Out > 0n
  } else {
    // Our token is token0, WETH is token1
    // BUY: amount0Out > 0 (receiving our token)
    // SELL: amount0In > 0 (selling our token)
    isBuy = amount0Out > 0n
  }
  
  const side = isBuy ? 'BUY' : 'SELL'

  // Calculate amounts based on actual token order (EXACT worker logic)
  let tokenAmount: bigint
  let ethAmount: bigint
  
  if (isWethToken0) {
    // WETH is token0, our token is token1
    if (isBuy) {
      // BUY: receiving token1 (our token), paying with token0 (WETH)
      tokenAmount = amount1Out
      ethAmount = amount0In
    } else {
      // SELL: selling token1 (our token), receiving token0 (WETH)
      tokenAmount = amount1In
      ethAmount = amount0Out
    }
  } else {
    // Our token is token0, WETH is token1
    if (isBuy) {
      // BUY: receiving token0 (our token), paying with token1 (WETH)
      tokenAmount = amount0Out
      ethAmount = amount1In
    } else {
      // SELL: selling token0 (our token), receiving token1 (WETH)
      tokenAmount = amount0In
      ethAmount = amount1Out
    }
  }

  // Debug logging
  console.log(`DEX ${side} debug - operationType: ${operationType}, amount0In: ${amount0In}, amount1In: ${amount1In}, amount0Out: ${amount0Out}, amount1Out: ${amount1Out}`)
  console.log(`DEX ${side} calculated - tokenAmount: ${tokenAmount}, ethAmount: ${ethAmount}`)

  // Check for zero values
  if (tokenAmount === 0n || ethAmount === 0n) {
    console.log(`Skipping DEX transaction due to zero amount - tokenAmount: ${tokenAmount}, ethAmount: ${ethAmount}`)
    return
  }

  // Calculate price
  const priceEthPerToken = Number(ethAmount) / Number(tokenAmount)
  
  const userAddress = isBuy ? to : tx.from
  const fromAddress = isBuy ? log.address : userAddress
  const toAddress = isBuy ? userAddress : log.address

  // Insert into token_transfers
  await db.query(`
    INSERT INTO public.token_transfers
      (token_id, chain_id, contract_address, block_number, block_time, tx_hash, log_index, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, side, src, eth_price_usd)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    ON CONFLICT (chain_id, tx_hash, log_index) DO UPDATE SET
      side = EXCLUDED.side,
      src = EXCLUDED.src,
      eth_price_usd = EXCLUDED.eth_price_usd,
      amount_wei = EXCLUDED.amount_wei,
      amount_eth_wei = EXCLUDED.amount_eth_wei,
      price_eth_per_token = EXCLUDED.price_eth_per_token
  `, [
    tokenId, chainId, tokenContractAddress, log.blockNumber, blockTime, log.transactionHash,
    log.index, fromAddress, toAddress, tokenAmount.toString(), ethAmount.toString(),
    priceEthPerToken, side, 'DEX', ethPriceUsd
  ])

  console.log(`✅ Parsed DEX ${side} swap for token ${tokenId}`)
}

/**
 * Parse sync log and insert into pair_snapshots
 */
async function parseSyncLog(
  tokenId: number,
  chainId: number,
  log: ethers.Log,
  blockTime: Date,
  dexPool: { pair_address: string; token0: string; token1: string; quote_token: string; token_decimals: number; quote_decimals: number },
  provider: ethers.JsonRpcProvider
): Promise<void> {
  // Decode sync log
  const [r0, r1] = ethers.AbiCoder.defaultAbiCoder().decode(['uint112','uint112'], log.data)
  const reserve0 = BigInt(r0.toString())
  const reserve1 = BigInt(r1.toString())

  // Get actual token order from pair contract
  const pairContract = new ethers.Contract(dexPool.pair_address, [
    'function token0() view returns (address)',
    'function token1() view returns (address)'
  ], provider)
  
  const actualToken0 = await pairContract.token0()
  
  // Map reserves to token and ETH
  let reserveTokenWei: bigint
  let reserveQuoteWei: bigint
  
  if (actualToken0.toLowerCase() === dexPool.token0.toLowerCase()) {
    reserveTokenWei = reserve0
    reserveQuoteWei = reserve1
  } else {
    reserveTokenWei = reserve1
    reserveQuoteWei = reserve0
  }

  // Calculate price
  const priceEthPerToken = 
    (Number(reserveQuoteWei) / 10 ** (dexPool.quote_decimals ?? 18)) /
    (Number(reserveTokenWei) / 10 ** (dexPool.token_decimals ?? 18))

  // Insert into pair_snapshots
  await db.query(`
    INSERT INTO public.pair_snapshots
      (chain_id, pair_address, block_number, block_time, reserve0_wei, reserve1_wei, price_eth_per_token)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (chain_id, pair_address, block_number)
    DO UPDATE SET
      block_time = EXCLUDED.block_time,
      reserve0_wei = EXCLUDED.reserve0_wei,
      reserve1_wei = EXCLUDED.reserve1_wei,
      price_eth_per_token = EXCLUDED.price_eth_per_token
  `, [
    chainId, dexPool.pair_address, log.blockNumber, blockTime,
    reserveTokenWei.toString(), reserveQuoteWei.toString(), priceEthPerToken
  ])

  console.log(`✅ Parsed DEX sync for token ${tokenId}`)
}