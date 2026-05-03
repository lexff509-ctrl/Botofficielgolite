ALTER TABLE "signals" ADD COLUMN "support_level" numeric(15, 8);--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "resistance_level" numeric(15, 8);--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "near_support" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "near_resistance" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "market_structure" varchar(20);--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "structure_break" varchar(20);--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "signal_score" numeric(8, 4);--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "bollinger_percent_b" numeric(8, 4);--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "bollinger_width" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "indicator_scores" jsonb;