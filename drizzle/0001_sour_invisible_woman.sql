CREATE TYPE "public"."bot_type" AS ENUM('signal', 'auto');--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "bot_type" "bot_type" DEFAULT 'signal' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "asset" varchar(50) DEFAULT 'EUR/USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "timeframe" varchar(20) DEFAULT '1m' NOT NULL;