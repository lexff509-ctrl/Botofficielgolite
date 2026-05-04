require('dotenv').config();
const pg = require('pg');
const bcrypt = require('bcryptjs');

async function run() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log("Connected to database");

    const email = 'admin@golite.com';
    const password = 'Admin1234';
    const username = 'Admin';
    const hashedPassword = await bcrypt.hash(password, 12);

    const res = await client.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    
    if (res.rows.length === 0) {
      console.log('Creating admin user...');
      await client.query(
        'INSERT INTO users (email, password, username, role, subscription_status, is_active, trade_mode, demo_balance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [email.toLowerCase(), hashedPassword, username, 'ADMIN', 'ACTIVE', true, 'DEMO', '10000.00']
      );
      console.log('Admin user created');
    } else {
      console.log('Admin user already exists, updating...');
      await client.query(
        'UPDATE users SET password = $1, role = $2, subscription_status = $3, is_active = $4 WHERE email = $5',
        [hashedPassword, 'ADMIN', 'ACTIVE', true, email.toLowerCase()]
      );
      console.log('Admin user updated');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
