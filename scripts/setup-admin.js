require('dotenv').config();
const { db } = require('./src/db/index');
const { users } = require('./src/db/schema');
const { eq } = require('drizzle-orm');
const bcrypt = require('bcryptjs');

async function run() {
  try {
    const email = 'Admin@golite.com';
    const password = 'Admin1234';
    const username = 'Admin';
    
    let [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    
    const hashedPassword = await bcrypt.hash(password, 12);
    
    if (!user) {
      console.log('Creating admin user...');
      [user] = await db.insert(users).values({
        email: email.toLowerCase(),
        password: hashedPassword,
        username,
        role: 'ADMIN',
        subscriptionStatus: 'ACTIVE',
        isActive: true,
        tradeMode: 'DEMO',
        demoBalance: '10000.00',
      }).returning();
      console.log('Admin user created:', user.id);
    } else {
      console.log('Admin user already exists:', user.id);
      await db.update(users).set({
        password: hashedPassword,
        role: 'ADMIN',
        subscriptionStatus: 'ACTIVE',
        isActive: true
      }).where(eq(users.id, user.id));
      console.log('Admin user updated');
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
