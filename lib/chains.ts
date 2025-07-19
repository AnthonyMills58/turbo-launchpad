import type { Chain } from 'viem'

export const megaethTestnet: Chain & { dexBaseUrl?: string } = {
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
}

export const megaethMainnet: Chain & { dexBaseUrl?: string } = {
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
}

export const sepoliaTestnet: Chain & { dexBaseUrl?: string } = {
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
}

export const chainNamesById: Record<number, string> = {
  [megaethTestnet.id]: megaethTestnet.name,
  [megaethMainnet.id]: megaethMainnet.name,
  [sepoliaTestnet.id]: sepoliaTestnet.name,
}

// Optional: map for easier access to full config by ID
export const chainsById: Record<number, typeof megaethTestnet> = {
  [megaethTestnet.id]: megaethTestnet,
  [megaethMainnet.id]: megaethMainnet,
  [sepoliaTestnet.id]: sepoliaTestnet,
}

