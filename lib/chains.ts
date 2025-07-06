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
