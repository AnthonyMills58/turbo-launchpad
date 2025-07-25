// ✅ Router addresses
export const GTE_ROUTER = '0xa6b579684e943f7d00d616a48cf99b5147fc57a5'
export const SEPOLIA_ROUTER = '0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3'

// ✅ Dynamic router mapping per chainId
export const DEX_ROUTER_BY_CHAIN: Record<number, string> = {
  6342: GTE_ROUTER,       // MegaETH Testnet
  11155111: SEPOLIA_ROUTER, // Sepolia Testnet
  // Add more if needed
}

// ✅ Minimal ABI for UniswapV2-style Router
// ✅ Minimal ABI for UniswapV2-style Router
export const routerAbi = [
  'function factory() external view returns (address)',
  'function WETH() external pure returns (address)',
  'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)'
]

// ✅ Minimal ABI for UniswapV2-style Factory
export const factoryAbi = [
  'function getPair(address tokenA, address tokenB) external view returns (address)',
]

export const pairAbi = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
]


