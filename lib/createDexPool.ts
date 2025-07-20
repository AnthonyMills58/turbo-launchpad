import { ethers } from 'ethers'
import { DEX_ROUTER_BY_CHAIN, routerAbi, factoryAbi } from './dex'
import TurboTokenABI from './abi/TurboToken.json'
import { Token } from '../types/token'
import { chainsById } from './chains'

export async function createDexPool({
  token,
  tokenAmount,
  ethAmount,
  address,
  chainId,
}: {
  token: Token
  tokenAmount: string
  ethAmount: string
  address: string
  chainId: number
}): Promise<void> {
  const chain = chainsById[chainId]
  if (!chain) throw new Error('Unsupported chain ID')

  const browserProvider = new ethers.BrowserProvider(window.ethereum)
  const signer = await browserProvider.getSigner()

  const tokenContract = new ethers.Contract(token.contract_address, TurboTokenABI.abi, signer)
  const routerAddress = DEX_ROUTER_BY_CHAIN[chainId]
  const router = new ethers.Contract(routerAddress, routerAbi, signer)

  const tokenAmountWei = ethers.parseUnits(tokenAmount, 18)
  const ethAmountWei = ethers.parseUnits(ethAmount, 18)
  const deadline = Math.floor(Date.now() / 1000) + 60 * 10

  // 1. Approve
  const approveTx = await tokenContract.approve(routerAddress, tokenAmountWei)
  await approveTx.wait()
  console.log('✅ approve() confirmed')

  // 2. Add liquidity
  const addTx = await router.addLiquidityETH(
    token.contract_address,
    tokenAmountWei,
    0,
    0,
    address,
    deadline,
    { value: ethAmountWei }
  )
  await addTx.wait()
  console.log('✅ addLiquidityETH confirmed')

  // 3. Get factory + pair address
  const factoryAddress = await router.factory()
  const factory = new ethers.Contract(factoryAddress, factoryAbi, signer)
  const wethAddress = await router.WETH()
  const pairAddress = await factory.getPair(token.contract_address, wethAddress)

  if (!pairAddress || pairAddress === ethers.ZeroAddress) {
    throw new Error('Failed to retrieve pair address after liquidity was added')
  }

  // 4. Build DEX link
  const dexUrl =
    chain.id === 6342
      ? `${chain.dexBaseUrl}/${token.contract_address}/${pairAddress}`
      : `${chain.dexBaseUrl}/${pairAddress}`

  // 5. Save to DB
  const res = await fetch('/api/mark-dex-listing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress: token.contract_address,
      dexUrl,
    }),
  })

  const result = await res.json()
  console.log('[createDexPool] mark-dex-listing response:', result)
}



