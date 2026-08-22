-- World-class, internationally-usable contact & address fields for parties.
-- Additive & nullable. Address parts are kept generic (State/Province/County,
-- Postal code, Country) so the same form serves users anywhere.

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "first_name" varchar(128);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "last_name" varchar(128);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "mobile" varchar(64);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "website" varchar(255);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "address_line2" varchar(255);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "address_state" varchar(128);
--> statement-breakpoint
ALTER TABLE "ap_suppliers" ADD COLUMN IF NOT EXISTS "first_name" varchar(128);
--> statement-breakpoint
ALTER TABLE "ap_suppliers" ADD COLUMN IF NOT EXISTS "last_name" varchar(128);
--> statement-breakpoint
ALTER TABLE "ap_suppliers" ADD COLUMN IF NOT EXISTS "mobile" varchar(64);
--> statement-breakpoint
ALTER TABLE "ap_suppliers" ADD COLUMN IF NOT EXISTS "website" varchar(255);
--> statement-breakpoint
ALTER TABLE "ap_suppliers" ADD COLUMN IF NOT EXISTS "address_street" varchar(255);
--> statement-breakpoint
ALTER TABLE "ap_suppliers" ADD COLUMN IF NOT EXISTS "address_line2" varchar(255);
--> statement-breakpoint
ALTER TABLE "ap_suppliers" ADD COLUMN IF NOT EXISTS "address_city" varchar(128);
--> statement-breakpoint
ALTER TABLE "ap_suppliers" ADD COLUMN IF NOT EXISTS "address_state" varchar(128);
--> statement-breakpoint
ALTER TABLE "ap_suppliers" ADD COLUMN IF NOT EXISTS "address_postcode" varchar(32);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "phone" varchar(64);
