const { Pool } = require('pg');

const pool = new Pool({
  connectionString: "postgresql://postgres:RyNacHrnYhQdMDNRWnlQjtTrMwGzFJhL@interchange.proxy.rlwy.net:24184/turbodb"
});

async function checkDBStatus() {
  try {
    console.log('=== DATABASE STATUS AFTER WORKER RUN ===\n');
    
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
    
    // Check graduation records
    const { rows: graduations } = await pool.query(`
      SELECT token_id, tx_hash, side, src, from_address, to_address, graduation_metadata, block_number
      FROM token_transfers 
      WHERE side = 'GRADUATION'
      ORDER BY block_number DESC
    `);
    console.log('\nGRADUATION RECORDS:');
    console.log(`Count: ${graduations.length}`);
    graduations.forEach(g => {
      console.log(`  Token ${g.token_id}: ${g.side} (${g.src}), ${g.from_address} -> ${g.to_address}, block: ${g.block_number}`);
    });
    
    // Check for new graduation format (should be 4 records per graduation)
    const { rows: graduationCounts } = await pool.query(`
      SELECT token_id, tx_hash, COUNT(*) as record_count
      FROM token_transfers 
      WHERE side IN ('GRADUATION', 'LP_CREATION', 'LP_DISTRIBUTION') OR (side = 'BUY' AND src = 'BC' AND log_index = 1)
      GROUP BY token_id, tx_hash
      ORDER BY token_id, tx_hash
    `);
    console.log('\nGRADUATION TRANSACTION RECORD COUNTS:');
    graduationCounts.forEach(g => {
      console.log(`  Token ${g.token_id}, tx ${g.tx_hash}: ${g.record_count} records`);
    });
    
    // Check DEX operations for token 20
    const { rows: token20Dex } = await pool.query(`
      SELECT tx_hash, log_index, side, src, from_address, to_address, amount_wei, amount_eth_wei, price_eth_per_token, block_number
      FROM token_transfers 
      WHERE token_id = 20 AND src = 'DEX'
      ORDER BY block_number DESC, log_index DESC
      LIMIT 10
    `);
    console.log('\nTOKEN 20 DEX OPERATIONS:');
    token20Dex.forEach(t => {
      console.log(`  ${t.side} (${t.src}): ${t.from_address} -> ${t.to_address}, amount: ${t.amount_wei}, eth: ${t.amount_eth_wei}, price: ${t.price_eth_per_token}, block: ${t.block_number}`);
    });
    
    // Check if DEX operations have correct address mapping
    const { rows: dexAddressIssues } = await pool.query(`
      SELECT token_id, tx_hash, side, from_address, to_address
      FROM token_transfers 
      WHERE src = 'DEX' AND from_address = to_address
      LIMIT 5
    `);
    console.log('\nDEX OPERATIONS WITH SAME FROM/TO ADDRESSES:');
    dexAddressIssues.forEach(t => {
      console.log(`  Token ${t.token_id}, ${t.side}: ${t.from_address} -> ${t.to_address}`);
    });
    
  } catch (error) {
    console.error('Database check error:', error);
  } finally {
    await pool.end();
  }
}

checkDBStatus();
