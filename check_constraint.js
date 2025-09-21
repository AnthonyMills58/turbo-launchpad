const pool = require('./lib/db').default;

(async () => {
  try {
    // Check current intervals
    const result = await pool.query('SELECT DISTINCT interval_type FROM token_chart_agg ORDER BY interval_type');
    console.log('Current intervals in database:', result.rows.map(r => r.interval_type));
    
    // Check the constraint
    const constraint = await pool.query(`
      SELECT conname, consrc 
      FROM pg_constraint 
      WHERE conname = 'token_chart_agg_interval_check'
    `);
    console.log('Constraint definition:', constraint.rows);
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
