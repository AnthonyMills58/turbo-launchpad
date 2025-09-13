const pool = require('./lib/db').default;

async function checkToken20() {
  try {
    const result = await pool.query('SELECT id, contract_address, last_processed_block FROM tokens WHERE id = 20');
    console.log('Token 20 info:', result.rows[0]);
    
    // Check if there are any transfer records for token 20 around block 16219193
    const transferResult = await pool.query(`
      SELECT block_number, tx_hash, side, amount_wei 
      FROM token_transfers 
      WHERE token_id = 20 AND block_number BETWEEN 16219000 AND 16220000
      ORDER BY block_number
    `);
    console.log('Transfer records around block 16219193:', transferResult.rows);
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
  }
}

checkToken20();
