import pool from './lib/db.js';

(async () => {
  try {
    console.log('🔍 Checking current constraint...');
    
    // Check current constraint
    const constraint = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) as definition
      FROM pg_constraint 
      WHERE conname = 'token_chart_agg_interval_check'
    `);
    
    console.log('Current constraint:', constraint.rows);
    
    // Drop the old constraint
    console.log('🗑️ Dropping old constraint...');
    await pool.query('ALTER TABLE token_chart_agg DROP CONSTRAINT IF EXISTS token_chart_agg_interval_check');
    
    // Add new constraint that allows 4h
    console.log('✅ Adding new constraint with 4h support...');
    await pool.query(`
      ALTER TABLE token_chart_agg 
      ADD CONSTRAINT token_chart_agg_interval_check 
      CHECK (interval_type IN ('1m', '1d', '1w', '1M', '4h'))
    `);
    
    console.log('✅ Constraint updated successfully!');
    
    // Verify the new constraint
    const newConstraint = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) as definition
      FROM pg_constraint 
      WHERE conname = 'token_chart_agg_interval_check'
    `);
    
    console.log('New constraint:', newConstraint.rows);
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
