#!/usr/bin/env node

require('dotenv/config');
const { Pool } = require('pg');

// Create database connection directly
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkTokenTransfers() {
  try {
    console.log('🔍 Checking token_transfers table...');
    console.log('🔗 Database URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');
    
    // Get total count
    const countResult = await pool.query('SELECT COUNT(*) as total FROM public.token_transfers');
    console.log(`📊 Total records: ${countResult.rows[0].total}`);
    
    // Get latest 10 records
    console.log('\n📋 Latest 10 records:');
    const latestResult = await pool.query(`
      SELECT 
        log_index,
        from_address,
        to_address,
        amount_wei,
        amount_eth_wei,
        price_eth_per_token,
        side,
        src,
        graduation_metadata
      FROM public.token_transfers 
      ORDER BY block_number DESC, log_index DESC 
      LIMIT 10
    `);
    
    console.table(latestResult.rows);
    
    // Check graduation records specifically
    console.log('\n🎓 Graduation records:');
    const graduationResult = await pool.query(`
      SELECT 
        log_index,
        from_address,
        to_address,
        amount_wei,
        amount_eth_wei,
        price_eth_per_token,
        side,
        src,
        graduation_metadata
      FROM public.token_transfers 
      WHERE side = 'GRADUATION' OR graduation_metadata IS NOT NULL
      ORDER BY block_number DESC, log_index DESC
    `);
    
    console.table(graduationResult.rows);
    
    // Count by side
    console.log('\n📈 Records by side:');
    const sideResult = await pool.query(`
      SELECT side, COUNT(*) as count 
      FROM public.token_transfers 
      GROUP BY side 
      ORDER BY count DESC
    `);
    
    console.table(sideResult.rows);
    
    // Count by src
    console.log('\n📈 Records by src:');
    const srcResult = await pool.query(`
      SELECT src, COUNT(*) as count 
      FROM public.token_transfers 
      GROUP BY src 
      ORDER BY count DESC
    `);
    
    console.table(srcResult.rows);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

checkTokenTransfers();
