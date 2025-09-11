const { Pool } = require('pg');

const pool = new Pool({
  connectionString: "postgresql://postgres:RyNacHrnYhQdMDNRWnlQjtTrMwGzFJhL@interchange.proxy.rlwy.net:24184/turbodb"
});

async function inspectDB() {
  try {
    console.log('=== DATABASE INSPECTION ===\n');
    
    // Check dex_pools
    const { rows: dexPools } = await pool.query('SELECT token_id, pair_address, last_processed_block FROM dex_pools ORDER BY token_id');
    console.log('DEX POOLS:');
    console.log(`Count: ${dexPools.length}`);
    dexPools.forEach(pool => {
      console.log(`  Token ${pool.token_id}: ${pool.pair_address} (last_block: ${pool.last_processed_block})`);
    });
    
    // Check pair_snapshots
    const { rows: snapshots } = await pool.query('SELECT COUNT(*) as count FROM pair_snapshots');
    console.log(`\nPAIR SNAPSHOTS: ${snapshots[0].count}`);
    
    // Check token_transfers for token 20
    const { rows: token20Transfers } = await pool.query(`
      SELECT tx_hash, log_index, side, src, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, block_number
      FROM token_transfers 
      WHERE token_id = 20 
      ORDER BY block_number DESC, log_index DESC
      LIMIT 10
    `);
    console.log('\nTOKEN 20 TRANSFERS (latest 10):');
    token20Transfers.forEach(t => {
      console.log(`  ${t.side} (${t.src}): ${t.from_address} -> ${t.to_address}, amount: ${t.amount_wei}, eth: ${t.amount_eth_wei}, price: ${t.price_eth_per_token}, block: ${t.block_number}`);
    });
    
    // Check graduation records
    const { rows: graduations } = await pool.query(`
      SELECT token_id, tx_hash, side, src, from_address, to_address, graduation_metadata, block_number
      FROM token_transfers 
      WHERE side = 'GRADUATION'
      ORDER BY block_number DESC
    `);
    console.log('\nGRADUATION RECORDS:');
    graduations.forEach(g => {
      console.log(`  Token ${g.token_id}: ${g.side} (${g.src}), ${g.from_address} -> ${g.to_address}, block: ${g.block_number}`);
      if (g.graduation_metadata) {
        console.log(`    Metadata: ${g.graduation_metadata}`);
      }
    });
    
    // Check for missing last_processed_block
    const { rows: missingBlocks } = await pool.query(`
      SELECT token_id, pair_address, last_processed_block 
      FROM dex_pools 
      WHERE last_processed_block IS NULL
    `);
    console.log('\nDEX POOLS MISSING last_processed_block:');
    missingBlocks.forEach(p => {
      console.log(`  Token ${p.token_id}: ${p.pair_address}`);
    });
    
  } catch (error) {
    console.error('Database inspection error:', error);
  } finally {
    await pool.end();
  }
}

inspectDB();
