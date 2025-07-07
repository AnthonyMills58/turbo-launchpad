import db from '@/lib/db'
import { syncTokenState } from '@/lib/syncTokensState'


async function main() {


  console.log('🔄 Syncing all tokens from DB...')

  const result = await db.query('SELECT id, contract_address FROM tokens')

  const tokens = result.rows as { id: number; contract_address: string }[]

  for (const token of tokens) {
    try {
      await syncTokenState(token.contract_address, token.id)
    } catch (err) {
      console.error(`❌ Failed to sync token ID ${token.id}:`, err)
    }
  }

  console.log('✅ Sync complete.')
  process.exit(0)
}

main().catch((err) => {
  console.error('💥 Script failed:', err)
  process.exit(1)
})
