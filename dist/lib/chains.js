"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chainsById = exports.chainNamesById = exports.sepoliaTestnet = exports.megaethMainnet = exports.megaethTestnet = void 0;
exports.megaethTestnet = {
    id: 6342,
    name: 'MegaETH Testnet',
    nativeCurrency: {
        name: 'ETH',
        symbol: 'ETH',
        decimals: 18,
    },
    rpcUrls: {
        default: {
            http: ['https://carrot.megaeth.com/rpc'],
        },
    },
    blockExplorers: {
        default: {
            name: 'OKLink',
            url: 'https://www.oklink.com/megaeth-testnet',
        },
    },
    testnet: true,
    dexBaseUrl: 'https://testnet.gte.xyz/trade/spot', // ✅ GTE on MegaETH Testnet
};
exports.megaethMainnet = {
    id: 9999, // Replace with real ID later
    name: 'MegaETH Mainnet (Coming Soon)',
    nativeCurrency: {
        name: 'ETH',
        symbol: 'ETH',
        decimals: 18,
    },
    rpcUrls: {
        default: {
            http: ['https://mainnet.megaeth.com/rpc'],
        },
    },
    blockExplorers: {
        default: {
            name: 'OKLink',
            url: 'https://www.oklink.com/megaeth',
        },
    },
    testnet: false,
    dexBaseUrl: 'https://app.gte.xyz/trade/spot', // 🔜 placeholder for future GTE Mainnet
};
exports.sepoliaTestnet = {
    id: 11155111,
    name: 'Sepolia Testnet',
    nativeCurrency: {
        name: 'Sepolia ETH',
        symbol: 'ETH',
        decimals: 18,
    },
    rpcUrls: {
        default: {
            http: ['https://sepolia.infura.io/v3/c62e2440577446019dc4fabb2e698c53'],
        },
    },
    blockExplorers: {
        default: {
            name: 'Etherscan',
            url: 'https://sepolia.etherscan.io',
        },
    },
    testnet: true,
    dexBaseUrl: 'https://sepolia.etherscan.io/address', // 👁️ Explorer only (Uniswap V2 not visible here)
};
exports.chainNamesById = {
    [exports.megaethTestnet.id]: exports.megaethTestnet.name,
    [exports.megaethMainnet.id]: exports.megaethMainnet.name,
    [exports.sepoliaTestnet.id]: exports.sepoliaTestnet.name,
};
// Optional: map for easier access to full config by ID
exports.chainsById = {
    [exports.megaethTestnet.id]: exports.megaethTestnet,
    [exports.megaethMainnet.id]: exports.megaethMainnet,
    [exports.sepoliaTestnet.id]: exports.sepoliaTestnet,
};
