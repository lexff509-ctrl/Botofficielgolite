require('dotenv').config();
const { db } = require('./dist/db/index');
const { users } = require('./dist/db/schema');
const { eq } = require('drizzle-orm');

async function run() {
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.email, 'Admin@golite.com')
    });
    console.log(JSON.stringify(user, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
