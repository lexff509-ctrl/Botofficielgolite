import { z } from "zod";

// Auth
export const loginSchema = z.object({
  email: z.string().email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export const registerSchema = z.object({
  email: z.string().email("Email invalide"),
  password: z.string().min(6, "Minimum 6 caractères"),
  username: z
    .string()
    .min(2, "Minimum 2 caractères")
    .max(50, "Maximum 50 caractères"),
});

// Bot
export const botActionSchema = z.object({
  action: z.enum(["START", "STOP", "RESET_COMPOUND", "CLEAR_HISTORY"]),
  mode: z.enum(["DEMO", "LIVE"]).optional(),
  botType: z.enum(["signal", "auto"]).optional(),
  ssid: z.string().optional(),
  timeframe: z.string().optional(),
  asset: z.string().optional(),
  tradeAmount: z.number().positive("Le montant doit être positif").optional(),
  confidenceMode: z.enum(["standard", "high"]).optional(),
  profitTarget: z.number().min(1, "Minimum $1").optional(),
  lossLimit: z.number().min(1, "Minimum $1").optional(),
  // Martingale
  martingaleEnabled: z.boolean().optional(),
  // Compound interest
  compoundEnabled: z.boolean().optional(),
  compoundTradesTarget: z.number().int().min(1, "Minimum 1 trade").max(20, "Maximum 20 trades").optional(),
  compoundPayoutRate: z.number().min(0.5).max(1.0).optional(),
});

// Signals
export const signalRequestSchema = z.object({
  asset: z.string().min(1).optional(),
  timeframe: z
    .string()
    .refine(
      (v) => ["5s", "10s", "15s", "30s", "1m", "3m", "5m"].includes(v),
      "Timeframe invalide"
    )
    .optional(),
});

// Trades
export const tradeCreateSchema = z.object({
  asset: z.string().min(1),
  direction: z.enum(["CALL", "PUT"]),
  amount: z.number().positive("Le montant doit être positif"),
  timeframe: z.string().min(1),
  openPrice: z.number().positive().optional(),
  mode: z.enum(["DEMO", "LIVE"]).optional(),
  isAutomatic: z.boolean().optional(),
});

// Payment
export const paymentCreateSchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.enum(["USDT", "MONCASH"]).default("USDT"),
  txHash: z.string().optional(),
  planMonths: z.number().int().min(1).max(12).default(1),
  moncashSenderPhone: z.string().optional(),
  moncashValidationName: z.string().optional(),
  promoCode: z.string().optional(),
});

export const paymentReviewSchema = z.object({
  paymentId: z.number().int().positive(),
  status: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().optional(),
});

// Admin
export const adminUserUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  isVerified: z.boolean().optional(),
  subscriptionStatus: z
    .enum(["FREE", "TRIAL", "ACTIVE", "EXPIRED", "PENDING_PAYMENT"])
    .optional(),
  subscriptionExpiresAt: z.string().optional(),
  backtestingDaysGranted: z.number().int().optional(),
  tradeMode: z.enum(["DEMO", "LIVE"]).optional(),
  demoBalance: z.string().optional(),
  resetPassword: z.string().min(6, "Minimum 6 caractères").optional(),
});

export const adminSettingsSchema = z.object({
  action: z.enum(["SET", "CLEAR", "SET_PAYOUT_RATE"]),
  globalSsid: z.string().optional(),
  payoutRate: z.number().min(0.5).max(1.0).optional(),
});

// Profile
export const profileUpdateSchema = z.object({
  username: z.string().min(2).max(50).optional(),
  tradeMode: z.enum(["DEMO", "LIVE"]).optional(),
  pocketOptionUid: z.string().max(50).optional(),
  pocketOptionSsid: z.string().optional(),
  demoTradeAmount: z.string().optional(),
  liveTradeAmount: z.string().optional(),
  profitTarget: z.number().min(1, "Minimum $1").nullable().optional(),
  lossLimit: z.number().min(1, "Minimum $1").nullable().optional(),
});

// Pagination
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  mode: z.enum(["DEMO", "LIVE"]).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type BotActionInput = z.infer<typeof botActionSchema>;
export type SignalRequestInput = z.infer<typeof signalRequestSchema>;
export type TradeCreateInput = z.infer<typeof tradeCreateSchema>;
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;
export type PaymentReviewInput = z.infer<typeof paymentReviewSchema>;
export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateSchema>;
export type AdminSettingsInput = z.infer<typeof adminSettingsSchema>;
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
