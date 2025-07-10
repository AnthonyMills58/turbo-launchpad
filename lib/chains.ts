import type { Chain } from 'viem'



export const megaethTestnet: Chain = {
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
};

export const megaethMainnet: Chain = {
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
};

export const sepoliaTestnet: Chain = {
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
}

export const chainNamesById: Record<number, string> = {
  [megaethTestnet.id]: megaethTestnet.name,
  [megaethMainnet.id]: megaethMainnet.name,
  [sepoliaTestnet.id]: sepoliaTestnet.name,
}

