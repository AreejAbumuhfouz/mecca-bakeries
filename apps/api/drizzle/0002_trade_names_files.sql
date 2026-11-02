CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_names" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"logo_file_id" uuid,
	"phone" text,
	"email" text,
	"address" text,
	"invoice_prefix" text NOT NULL,
	"next_invoice_number" integer DEFAULT 1 NOT NULL,
	"invoice_footer" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "trade_name_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_names" ADD CONSTRAINT "trade_names_logo_file_id_files_id_fk" FOREIGN KEY ("logo_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_names_name_unique" ON "trade_names" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "trade_names_invoice_prefix_unique" ON "trade_names" USING btree ("invoice_prefix");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_trade_name_id_trade_names_id_fk" FOREIGN KEY ("trade_name_id") REFERENCES "public"."trade_names"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_trade_name_idx" ON "customers" USING btree ("trade_name_id");