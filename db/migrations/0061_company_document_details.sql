-- Company details that every outbound business document needs.
--
-- Customers and suppliers already carry a full address, tax number, phone and
-- email — but the ORGANISATION itself had only a name and a logo, so a printed
-- invoice could not show who issued it, from where, under what tax
-- registration, or where to send the money. Statutory invoice requirements in
-- most jurisdictions (and every corporate AP department) need these.
--
-- All additive + nullable — safe on existing rows.

ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "address_street" varchar(255);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "address_line2" varchar(255);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "address_city" varchar(128);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "address_state" varchar(128);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "address_postcode" varchar(32);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "address_country" varchar(64);
--> statement-breakpoint

ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "phone" varchar(64);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "email" varchar(255);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "website" varchar(255);
--> statement-breakpoint

-- Statutory identifiers printed on invoices (VAT/GST/NTN, company reg no.).
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "tax_number" varchar(64);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "registration_number" varchar(64);
--> statement-breakpoint

-- Remittance block — "how do I pay this invoice", the single most common
-- reason an AP clerk has to phone the supplier.
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "bank_name" varchar(255);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "bank_account_name" varchar(255);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "bank_account_number" varchar(64);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "bank_iban" varchar(64);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "bank_swift" varchar(32);
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "bank_branch" varchar(255);
--> statement-breakpoint

-- Free-text blocks shown on outbound documents.
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "document_terms" text;
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "document_footer" text;
