CREATE TABLE "platform_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "martingale_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "martingale_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "compound_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "compound_trades_target" integer;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "compound_trades_taken" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "compound_current_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "compound_initial_amount" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "use_global_ssid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "ema20" numeric(15, 8);--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "ema50" numeric(15, 8);--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "stoch_k" numeric(8, 4);--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "stoch_d" numeric(8, 4);--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "low_fractal" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "high_fractal" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "doji_filtered" boolean DEFAULT false;