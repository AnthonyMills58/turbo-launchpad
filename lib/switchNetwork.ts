// switchNetwork.ts

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

export async function switchToMegaTestnet(): Promise<boolean> {
  const megaChainId = '0x18c6' // 6342 in hex

  const ethereum = window.ethereum
  if (!ethereum) {
    alert('Ethereum provider not found.')
    return false
  }

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: megaChainId }],
    })
    console.log('Switched to Mega Testnet')
    return true
  } catch (switchError: unknown) {
    if (
      typeof switchError === 'object' &&
      switchError !== null &&
      'code' in switchError &&
      typeof (switchError as { code: number }).code === 'number'
    ) {
      const errorCode = (switchError as { code: number }).code

      if (errorCode === 4902) {
        try {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: megaChainId,
                chainName: 'Mega Testnet',
                rpcUrls: ['https://carrot.megaeth.com/rpc'],
                nativeCurrency: {
                  name: 'ETH',
                  symbol: 'ETH',
                  decimals: 18,
                },
                blockExplorerUrls: ['https://megaexplorer.xyz'],
              },
            ],
          })

          await ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: megaChainId }],
          })

          console.log('Added and switched to Mega Testnet')
          return true
        } catch (addError) {
          alert('Failed to add MegaETH network.')
          console.error('Add chain error:', addError)
          return false
        }
      } else {
        alert('Failed to switch network.')
        console.error('Switch error:', switchError)
        return false
      }
    } else {
      alert('Unexpected error switching network.')
      console.error('Unexpected error:', switchError)
      return false
    }
  }
}








