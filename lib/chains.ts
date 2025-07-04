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
      name: 'Mega Explorer',
      url: 'https://megaexplorer.xyz',
    },
  },
  testnet: true
}


// Placeholder for mainnet
export const megaethMainnet = {
  id: 9999, // Replace with real ID when known
  name: 'MegaETH Mainnet (Coming Soon)',
  nativeCurrency: {
    name: 'ETH',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://mainnet.megaeth.com/rpc'], // Replace when known
    },
  },
  blockExplorers: {
    default: {
      name: 'MegaETH Explorer',
      url: 'https://megaeth.com', // Placeholder
    },
  },
  testnet: false,
}
