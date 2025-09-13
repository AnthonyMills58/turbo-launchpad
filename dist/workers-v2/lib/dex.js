"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pairAbi = exports.factoryAbi = exports.routerAbi = exports.DEX_ROUTER_BY_CHAIN = exports.SEPOLIA_ROUTER = exports.GTE_ROUTER = void 0;
// ✅ Router addresses
exports.GTE_ROUTER = '0xa6b579684e943f7d00d616a48cf99b5147fc57a5';
exports.SEPOLIA_ROUTER = '0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3';
// ✅ Dynamic router mapping per chainId
exports.DEX_ROUTER_BY_CHAIN = {
    6342: exports.GTE_ROUTER, // MegaETH Testnet
    11155111: exports.SEPOLIA_ROUTER, // Sepolia Testnet
    // Add more if needed
};
// ✅ Minimal ABI for UniswapV2-style Router
// ✅ Minimal ABI for UniswapV2-style Router
exports.routerAbi = [
    'function factory() external view returns (address)',
    'function WETH() external pure returns (address)',
    'function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)'
];
// ✅ Minimal ABI for UniswapV2-style Factory
exports.factoryAbi = [
    'function getPair(address tokenA, address tokenB) external view returns (address)',
];
exports.pairAbi = [
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() view returns (address)',
    'function token1() view returns (address)'
];
