// types.d.ts
export {}

declare global {
  interface EthereumProvider {
    request: (args: {
      method: string
      params?: unknown[]
    }) => Promise<unknown>
  }

  interface Window {
    ethereum?: EthereumProvider
  }
}

