import "dotenv/config";
import pg from "pg";

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  console.log("Connecting to database...");

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Connected to database");

  const queries = [
    "ALTER TABLE signals ADD COLUMN ema20 numeric(15, 8)",
    "ALTER TABLE signals ADD COLUMN ema50 numeric(15, 8)",
    "ALTER TABLE signals ADD COLUMN stoch_k numeric(8, 4)",
    "ALTER TABLE signals ADD COLUMN stoch_d numeric(8, 4)",
    "ALTER TABLE signals ADD COLUMN low_fractal boolean DEFAULT false",
    "ALTER TABLE signals ADD COLUMN high_fractal boolean DEFAULT false",
    "ALTER TABLE signals ADD COLUMN doji_filtered boolean DEFAULT false",
    "ALTER TABLE users ADD COLUMN is_verified boolean DEFAULT false NOT NULL",
    "ALTER TABLE users ADD COLUMN session_version integer DEFAULT 0 NOT NULL",
    "ALTER TABLE users ADD COLUMN profit_target numeric(15, 2)",
    "ALTER TABLE users ADD COLUMN loss_limit numeric(15, 2)",
    "ALTER TABLE payment_requests ADD COLUMN moncash_sender_phone varchar(20)",
    "ALTER TABLE payment_requests ADD COLUMN moncash_validation_name varchar(100)",
  ];

  for (const q of queries) {
    try {
      await client.query(q);
      console.log("OK: " + q.substring(0, 80));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("already exists") || msg.includes("duplicate")) {
        console.log("EXISTS: " + q.substring(0, 80));
      } else {
        console.log("ERROR: " + q.substring(0, 60) + " - " + msg.substring(0, 100));
      }
    }
  }

  await client.end();
  console.log("Migration complete!");
}

migrate().catch((e: unknown) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
