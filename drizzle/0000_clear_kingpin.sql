CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('FREE', 'TRIAL', 'ACTIVE', 'EXPIRED', 'PENDING_PAYMENT');--> statement-breakpoint
CREATE TYPE "public"."trade_direction" AS ENUM('CALL', 'PUT');--> statement-breakpoint
CREATE TYPE "public"."trade_mode" AS ENUM('DEMO', 'LIVE');--> statement-breakpoint
CREATE TYPE "public"."trade_result" AS ENUM('WIN', 'LOSS', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'CLIENT');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" integer,
	"target_user_id" integer,
	"action" varchar(100) NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_token" text NOT NULL,
	"is_running" boolean DEFAULT false NOT NULL,
	"mode" "trade_mode" DEFAULT 'DEMO' NOT NULL,
	"total_trades" integer DEFAULT 0,
	"wins" integer DEFAULT 0,
	"losses" integer DEFAULT 0,
	"total_profit" numeric(15, 2) DEFAULT '0',
	"started_at" timestamp DEFAULT now() NOT NULL,
	"stopped_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "payment_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" varchar(10) DEFAULT 'USDT' NOT NULL,
	"tx_hash" varchar(255),
	"proof_file_path" text,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"plan_months" integer DEFAULT 1 NOT NULL,
	"admin_note" text,
	"reviewed_at" timestamp,
	"reviewed_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"asset" varchar(50) NOT NULL,
	"direction" "trade_direction" NOT NULL,
	"timeframe" varchar(20) NOT NULL,
	"confidence" numeric(5, 2),
	"rsi" numeric(8, 4),
	"macd" numeric(15, 8),
	"ema" numeric(15, 8),
	"bollinger" jsonb,
	"stochastic" numeric(8, 4),
	"multi_timeframe_confirmation" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"mode" "trade_mode" DEFAULT 'DEMO' NOT NULL,
	"asset" varchar(50) NOT NULL,
	"direction" "trade_direction" NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"open_price" numeric(15, 8),
	"close_price" numeric(15, 8),
	"timeframe" varchar(20) NOT NULL,
	"result" "trade_result" DEFAULT 'PENDING' NOT NULL,
	"profit" numeric(15, 2) DEFAULT '0',
	"is_automatic" boolean DEFAULT false NOT NULL,
	"indicators" jsonb,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" text NOT NULL,
	"username" varchar(100) NOT NULL,
	"role" "user_role" DEFAULT 'CLIENT' NOT NULL,
	"subscription_status" "subscription_status" DEFAULT 'FREE' NOT NULL,
	"subscription_expires_at" timestamp,
	"trial_used" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"pocket_option_ssid" text,
	"trade_mode" "trade_mode" DEFAULT 'DEMO' NOT NULL,
	"demo_balance" numeric(15, 2) DEFAULT '10000.00',
	"backtesting_days_granted" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD CONSTRAINT "bot_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;