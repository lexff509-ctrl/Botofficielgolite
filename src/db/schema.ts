import {
  pgTable,
  serial,
  text,
  varchar,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";

// Enums
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "FREE",
  "TRIAL",
  "ACTIVE",
  "EXPIRED",
  "PENDING_PAYMENT",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const tradeModeEnum = pgEnum("trade_mode", ["DEMO", "LIVE"]);

export const tradeDirectionEnum = pgEnum("trade_direction", ["CALL", "PUT"]);

export const tradeResultEnum = pgEnum("trade_result", [
  "WIN",
  "LOSS",
  "PENDING",
]);

export const userRoleEnum = pgEnum("user_role", ["ADMIN", "CLIENT"]);

// Users table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: text("password").notNull(),
  username: varchar("username", { length: 100 }).notNull(),
  role: userRoleEnum("role").default("CLIENT").notNull(),
  subscriptionStatus: subscriptionStatusEnum("subscription_status")
    .default("FREE")
    .notNull(),
  subscriptionExpiresAt: timestamp("subscription_expires_at"),
  trialUsed: boolean("trial_used").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  // PocketOption config
  pocketOptionSsid: text("pocket_option_ssid"),
  // Trading config
  tradeMode: tradeModeEnum("trade_mode").default("DEMO").notNull(),
  demoBalance: numeric("demo_balance", { precision: 15, scale: 2 }).default(
    "10000.00"
  ),
  // Backtesting
  backtestingDaysGranted: integer("backtesting_days_granted").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Payment requests table
export const paymentRequests = pgTable("payment_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("USDT").notNull(),
  txHash: varchar("tx_hash", { length: 255 }),
  proofFilePath: text("proof_file_path"),
  status: paymentStatusEnum("status").default("PENDING").notNull(),
  planMonths: integer("plan_months").default(1).notNull(),
  adminNote: text("admin_note"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Trades table
export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  mode: tradeModeEnum("mode").default("DEMO").notNull(),
  asset: varchar("asset", { length: 50 }).notNull(),
  direction: tradeDirectionEnum("direction").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
  openPrice: numeric("open_price", { precision: 15, scale: 8 }),
  closePrice: numeric("close_price", { precision: 15, scale: 8 }),
  timeframe: varchar("timeframe", { length: 20 }).notNull(),
  result: tradeResultEnum("result").default("PENDING").notNull(),
  profit: numeric("profit", { precision: 15, scale: 2 }).default("0"),
  isAutomatic: boolean("is_automatic").default(false).notNull(),
  indicators: jsonb("indicators"),
  openedAt: timestamp("opened_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
});

// Signals table
export const signals = pgTable("signals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  asset: varchar("asset", { length: 50 }).notNull(),
  direction: tradeDirectionEnum("direction").notNull(),
  timeframe: varchar("timeframe", { length: 20 }).notNull(),
  confidence: numeric("confidence", { precision: 5, scale: 2 }),
  rsi: numeric("rsi", { precision: 8, scale: 4 }),
  macd: numeric("macd", { precision: 15, scale: 8 }),
  ema: numeric("ema", { precision: 15, scale: 8 }),
  bollinger: jsonb("bollinger"),
  stochastic: numeric("stochastic", { precision: 8, scale: 4 }),
  multiTimeframeConfirmation: jsonb("multi_timeframe_confirmation"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Bot sessions table
export const botSessions = pgTable("bot_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  sessionToken: text("session_token").notNull(),
  isRunning: boolean("is_running").default(false).notNull(),
  mode: tradeModeEnum("mode").default("DEMO").notNull(),
  totalTrades: integer("total_trades").default(0),
  wins: integer("wins").default(0),
  losses: integer("losses").default(0),
  totalProfit: numeric("total_profit", { precision: 15, scale: 2 }).default(
    "0"
  ),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  stoppedAt: timestamp("stopped_at"),
});

// Audit log
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").references(() => users.id),
  targetUserId: integer("target_user_id").references(() => users.id),
  action: varchar("action", { length: 100 }).notNull(),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
