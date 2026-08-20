-- A journal line's "Name" (QBO-style Entity): the party a control-account line
-- ties to. Required on Accounts Receivable (Customer) and Accounts Payable
-- (Vendor) lines so the AR/AP subledgers reconcile; used for Payroll (Employee)
-- too. name_id links a real party where one exists; name_label is the shown
-- name (and the only field for free-typed employees). Additive, nullable.

ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "name_type" varchar(16);
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "name_id" uuid;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "name_label" varchar(255);
