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

export const ssidStatusEnum = pgEnum("ssid_status", [
  "VALID",
  "EXPIRED",
  "UNKNOWN",
  "NOT_SET",
]);

export const botTypeEnum = pgEnum("bot_type", ["signal", "auto"]);

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
  isVerified: boolean("is_verified").default(false).notNull(),
  sessionVersion: integer("session_version").default(0).notNull(),
  // PocketOption config
  pocketOptionUid: varchar("pocket_option_uid", { length: 50 }),
  pocketOptionSsid: text("pocket_option_ssid"),
  ssidStatus: ssidStatusEnum("ssid_status").default("NOT_SET").notNull(),
  // Trading config
  tradeMode: tradeModeEnum("trade_mode").default("DEMO").notNull(),
  demoBalance: numeric("demo_balance", { precision: 15, scale: 2 }).default(
    "10000.00"
  ),
  demoTradeAmount: numeric("demo_trade_amount", { precision: 15, scale: 2 }).default(
    "1.00"
  ),
  liveTradeAmount: numeric("live_trade_amount", { precision: 15, scale: 2 }).default(
    "1.00"
  ),
  // User-defined trading limits
  profitTarget: numeric("profit_target", { precision: 15, scale: 2 }),
  lossLimit: numeric("loss_limit", { precision: 15, scale: 2 }),
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
  // MonCash fields
  moncashSenderPhone: varchar("moncash_sender_phone", { length: 20 }),
  moncashValidationName: varchar("moncash_validation_name", { length: 100 }),
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
  poTradeId: varchar("po_trade_id", { length: 255 }),
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
  // Legacy indicators (kept for backward compatibility)
  rsi: numeric("rsi", { precision: 8, scale: 4 }),
  macd: numeric("macd", { precision: 15, scale: 8 }),
  ema: numeric("ema", { precision: 15, scale: 8 }),
  bollinger: jsonb("bollinger"),
  stochastic: numeric("stochastic", { precision: 8, scale: 4 }),
  // New strategy indicators
  ema20: numeric("ema20", { precision: 15, scale: 8 }),
  ema50: numeric("ema50", { precision: 15, scale: 8 }),
  stochK: numeric("stoch_k", { precision: 8, scale: 4 }),
  stochD: numeric("stoch_d", { precision: 8, scale: 4 }),
  lowFractal: boolean("low_fractal").default(false),
  highFractal: boolean("high_fractal").default(false),
  dojiFiltered: boolean("doji_filtered").default(false),
  multiTimeframeConfirmation: jsonb("multi_timeframe_confirmation"),
  // Scoring system indicators
  supportLevel: numeric("support_level", { precision: 15, scale: 8 }),
  resistanceLevel: numeric("resistance_level", { precision: 15, scale: 8 }),
  nearSupport: boolean("near_support").default(false),
  nearResistance: boolean("near_resistance").default(false),
  marketStructure: varchar("market_structure", { length: 20 }),
  structureBreak: varchar("structure_break", { length: 20 }),
  signalScore: numeric("signal_score", { precision: 8, scale: 4 }),
  bollingerPercentB: numeric("bollinger_percent_b", { precision: 8, scale: 4 }),
  bollingerWidth: numeric("bollinger_width", { precision: 8, scale: 6 }),
  indicatorScores: jsonb("indicator_scores"),
  diagnostic: text("diagnostic"),
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
  botType: botTypeEnum("bot_type").default("signal").notNull(),
  asset: varchar("asset", { length: 50 }).default("EUR/USD").notNull(),
  timeframe: varchar("timeframe", { length: 20 }).default("1m").notNull(),
  tradeAmount: numeric("trade_amount", { precision: 15, scale: 2 }).default(
    "1.00"
  ),
  totalTrades: integer("total_trades").default(0),
  wins: integer("wins").default(0),
  losses: integer("losses").default(0),
  totalProfit: numeric("total_profit", { precision: 15, scale: 2 }).default(
    "0"
  ),
  // Martingale
  martingaleEnabled: boolean("martingale_enabled").default(false).notNull(),
  martingaleLevel: integer("martingale_level").default(0).notNull(),
  // Compound interest
  compoundEnabled: boolean("compound_enabled").default(false).notNull(),
  compoundTradesTarget: integer("compound_trades_target"),
  compoundTradesTaken: integer("compound_trades_taken").default(0).notNull(),
  compoundCurrentAmount: numeric("compound_current_amount", { precision: 15, scale: 2 }),
  compoundInitialAmount: numeric("compound_initial_amount", { precision: 15, scale: 2 }),
  // Global SSID tracking
  useGlobalSsid: boolean("use_global_ssid").default(false).notNull(),
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

// Platform settings (key-value store for global config)
export const platformSettings = pgTable("platform_settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Promo Codes
export const promoCodes = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  discountPercent: integer("discount_percent").notNull(), // e.g. 100 for 100% free
  maxUses: integer("max_uses"), // null means unlimited
  currentUses: integer("current_uses").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  expiresAt: timestamp("expires_at"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Promo Code Usage (track who used what to prevent multi-use if needed)
export const promoCodeUsage = pgTable("promo_code_usage", {
  id: serial("id").primaryKey(),
  promoCodeId: integer("promo_code_id").references(() => promoCodes.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  usedAt: timestamp("used_at").defaultNow().notNull(),
});

// System Logs (For Admin Debugging)
export const systemLogs = pgTable("system_logs", {
  id: serial("id").primaryKey(),
  level: varchar("level", { length: 20 }).notNull(), // INFO, WARN, ERROR
  source: varchar("source", { length: 100 }).notNull(), // BotRunner, WebSocket, DB, etc.
  message: text("message").notNull(),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
