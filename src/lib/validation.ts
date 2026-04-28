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
  action: z.enum(["START", "STOP"]),
  mode: z.enum(["DEMO", "LIVE"]).optional(),
  botType: z.enum(["signal", "auto"]).optional(),
  ssid: z.string().optional(),
  timeframe: z.string().optional(),
  asset: z.string().optional(),
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
  amount: z.number().positive(),
  currency: z.enum(["USDT"]).default("USDT"),
  txHash: z.string().min(1, "Hash de transaction requis"),
  planMonths: z.number().int().min(1).max(12).default(1),
});

export const paymentReviewSchema = z.object({
  paymentId: z.number().int().positive(),
  status: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().optional(),
});

// Admin
export const adminUserUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  subscriptionStatus: z
    .enum(["FREE", "TRIAL", "ACTIVE", "EXPIRED", "PENDING_PAYMENT"])
    .optional(),
  subscriptionExpiresAt: z.string().optional(),
  backtestingDaysGranted: z.number().int().optional(),
  tradeMode: z.enum(["DEMO", "LIVE"]).optional(),
  demoBalance: z.string().optional(),
});

// Profile
export const profileUpdateSchema = z.object({
  username: z.string().min(2).max(50).optional(),
  tradeMode: z.enum(["DEMO", "LIVE"]).optional(),
  pocketOptionSsid: z.string().optional(),
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
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
