require('dotenv').config();
const pg = require('pg');

async function run() {
  const url = process.env.DATABASE_URL;
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const res = await client.query('SELECT * FROM signals WHERE user_id = 2 ORDER BY created_at DESC LIMIT 5');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
