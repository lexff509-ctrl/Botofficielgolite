CREATE TYPE "public"."ssid_status" AS ENUM('VALID', 'EXPIRED', 'UNKNOWN', 'NOT_SET');--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "trade_amount" numeric(15, 2) DEFAULT '1.00';--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "moncash_sender_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "payment_requests" ADD COLUMN "moncash_validation_name" varchar(100);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "po_trade_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "session_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ssid_status" "ssid_status" DEFAULT 'NOT_SET' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "demo_trade_amount" numeric(15, 2) DEFAULT '1.00';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "live_trade_amount" numeric(15, 2) DEFAULT '1.00';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profit_target" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "loss_limit" numeric(15, 2);