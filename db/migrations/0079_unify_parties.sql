-- Unify customers + ap_suppliers into one physical table, "parties",
-- discriminated by party_type ('customer' | 'supplier'). customers and
-- ap_suppliers become compatibility views (with INSTEAD OF triggers) over
-- parties, reproducing their original column names/types exactly, so every
-- existing SELECT/INSERT/UPDATE/DELETE/.returning() across the app keeps
-- working with NO code changes (same pattern already used for
-- ap_accounts -> accounts in 0037_accounts_canonical.sql).
--
-- Safety:
--  * Everything that mutates data/schema (backfill, FK drop, rename, FK
--    recreate) is ONE DO block gated on "customers is still a real base
--    table" — Postgres runs a DO block as a single atomic statement, so a
--    failure partway rolls the whole thing back; a second run (after
--    success) is a safe no-op because the guard no longer matches.
--  * Old tables are RENAMED, not dropped — customers_legacy/
--    ap_suppliers_legacy stay as an audit/rollback trail. Dropping them is a
--    separate, later migration once this has been verified stable.
--  * A foreign key can never reference a view, so every FK that pointed at
--    customers.id/ap_suppliers.id is dropped and recreated against
--    parties.id with its ORIGINAL onDelete behaviour, unchanged.
--  * Known, accepted tradeoff: a single FK on parties.id cannot also
--    enforce "must be party_type = 'customer'" (Postgres has no partial FK).
--    Application code already assumes this; verify it in software via
--    scripts/reconcile-foundation.ts, not the database.

CREATE TABLE IF NOT EXISTS "parties" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "party_type" varchar(16) NOT NULL,
  "name" varchar(255) NOT NULL,
  "code" varchar(64),
  "display_name" varchar(255),
  "country" varchar(64),
  "currency" varchar(8) NOT NULL DEFAULT 'EUR',
  "payment_terms" integer NOT NULL DEFAULT 30,
  "tax_number" varchar(64),
  "risk_rating" varchar(16) NOT NULL DEFAULT 'Low',
  "status" varchar(32) NOT NULL DEFAULT 'Active',
  "credit_limit" real,
  "account_owner_id" uuid REFERENCES "users"("id"),
  "collection_owner_id" uuid REFERENCES "users"("id"),
  "rep_id" uuid REFERENCES "reps"("id") ON DELETE SET NULL,
  "region_id" uuid REFERENCES "regions"("id") ON DELETE SET NULL,
  "notes" text,
  "payment_method" varchar(64),
  "phone" varchar(64),
  "mobile" varchar(64),
  "email" varchar(255),
  "website" varchar(255),
  "first_name" varchar(128),
  "last_name" varchar(128),
  "company_name" varchar(255),
  "address" text,
  "address_street" varchar(255),
  "address_line2" varchar(255),
  "address_city" varchar(128),
  "address_state" varchar(128),
  "address_postcode" varchar(32),
  "qbo_id" varchar(64),
  "xero_id" varchar(64),
  "sage_intacct_id" varchar(64),
  "source" varchar(16) NOT NULL DEFAULT 'native',
  "last_synced_at" timestamp,
  "chase_by_project" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$
DECLARE r RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'customers' AND table_type = 'BASE TABLE'
  ) THEN

    -- Backfill customers -> parties, preserving id/timestamps exactly.
    -- source is inferred the same way the rest of the app already infers
    -- "native" for customers (qbo_id/xero_id/sage_intacct_id all null).
    INSERT INTO parties (
      id, org_id, party_type, name, code, country, currency, payment_terms, tax_number,
      risk_rating, status, credit_limit, account_owner_id, collection_owner_id, rep_id, region_id,
      notes, payment_method, phone, mobile, email, website, first_name, last_name, company_name,
      address_street, address_line2, address_city, address_state, address_postcode,
      qbo_id, xero_id, sage_intacct_id, source, chase_by_project, created_at, updated_at
    )
    SELECT
      c.id, c.org_id, 'customer', c.name, c.code, c.country, c.currency, c.payment_terms, c.tax_number,
      c.risk_rating, c.status, c.credit_limit, c.account_owner_id, c.collection_owner_id, c.rep_id, c.region_id,
      c.notes, c.payment_method, c.phone, c.mobile, c.email, c.website, c.first_name, c.last_name, c.company_name,
      c.address_street, c.address_line2, c.address_city, c.address_state, c.address_postcode,
      c.qbo_id, c.xero_id, c.sage_intacct_id,
      CASE WHEN c.qbo_id IS NOT NULL THEN 'qbo' WHEN c.xero_id IS NOT NULL THEN 'xero'
           WHEN c.sage_intacct_id IS NOT NULL THEN 'sage' ELSE 'native' END,
      c.chase_by_project, c.created_at, c.updated_at
    FROM customers c
    WHERE NOT EXISTS (SELECT 1 FROM parties p WHERE p.id = c.id);

    -- Backfill ap_suppliers -> parties.
    INSERT INTO parties (
      id, org_id, party_type, name, display_name, code, email, phone, mobile, website,
      first_name, last_name, address, address_street, address_line2, address_city, address_state, address_postcode,
      country, currency, payment_terms, tax_number, status, risk_rating, notes,
      qbo_id, xero_id, sage_intacct_id, source, last_synced_at, created_at, updated_at
    )
    SELECT
      s.id, s.org_id, 'supplier', s.name, s.display_name, s.code, s.email, s.phone, s.mobile, s.website,
      s.first_name, s.last_name, s.address, s.address_street, s.address_line2, s.address_city, s.address_state, s.address_postcode,
      s.country, s.currency, s.payment_terms, s.tax_number, s.status, s.risk_rating, s.notes,
      s.qbo_id, s.xero_id, s.sage_intacct_id, s.source, s.last_synced_at, s.created_at, s.updated_at
    FROM ap_suppliers s
    WHERE NOT EXISTS (SELECT 1 FROM parties p WHERE p.id = s.id);

    -- Drop every FK pointing at the two old tables, whatever it happens to
    -- be named (dynamic discovery — robust to naming-convention drift).
    FOR r IN
      SELECT con.conname, rel.relname AS tbl
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_class frel ON frel.oid = con.confrelid
      WHERE con.contype = 'f' AND frel.relname IN ('customers', 'ap_suppliers')
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tbl, r.conname);
    END LOOP;

    ALTER TABLE customers RENAME TO customers_legacy;
    ALTER TABLE ap_suppliers RENAME TO ap_suppliers_legacy;

    -- Recreate every FK against parties(id), each with its ORIGINAL
    -- onDelete behaviour (grepped from db/schema.ts, current state).
    ALTER TABLE contacts ADD CONSTRAINT contacts_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE CASCADE;
    ALTER TABLE projects ADD CONSTRAINT projects_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE CASCADE;
    ALTER TABLE invoices ADD CONSTRAINT invoices_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE CASCADE;
    ALTER TABLE customer_portal_tokens ADD CONSTRAINT customer_portal_tokens_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE CASCADE;
    ALTER TABLE invoice_promises ADD CONSTRAINT invoice_promises_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE CASCADE;
    ALTER TABLE invoice_disputes ADD CONSTRAINT invoice_disputes_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE CASCADE;
    ALTER TABLE payments ADD CONSTRAINT payments_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE SET NULL;
    ALTER TABLE refund_receipts ADD CONSTRAINT refund_receipts_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE SET NULL;
    ALTER TABLE deposits ADD CONSTRAINT deposits_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE SET NULL;
    ALTER TABLE journal_entry_ar_lines ADD CONSTRAINT journal_entry_ar_lines_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE SET NULL;
    ALTER TABLE communications ADD CONSTRAINT communications_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE CASCADE;
    ALTER TABLE tasks ADD CONSTRAINT tasks_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE CASCADE;
    ALTER TABLE estimates ADD CONSTRAINT estimates_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE CASCADE;
    ALTER TABLE audit_events ADD CONSTRAINT audit_events_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE CASCADE;
    ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_customer_id_parties_id_fk FOREIGN KEY (customer_id) REFERENCES parties(id) ON DELETE SET NULL;

    ALTER TABLE ap_supplier_contacts ADD CONSTRAINT ap_supplier_contacts_supplier_id_parties_id_fk FOREIGN KEY (supplier_id) REFERENCES parties(id) ON DELETE CASCADE;
    ALTER TABLE purchase_requests ADD CONSTRAINT purchase_requests_supplier_id_parties_id_fk FOREIGN KEY (supplier_id) REFERENCES parties(id) ON DELETE SET NULL;
    ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_supplier_id_parties_id_fk FOREIGN KEY (supplier_id) REFERENCES parties(id) ON DELETE SET NULL;
    ALTER TABLE ap_bills ADD CONSTRAINT ap_bills_supplier_id_parties_id_fk FOREIGN KEY (supplier_id) REFERENCES parties(id) ON DELETE SET NULL;
    ALTER TABLE ap_supplier_queries ADD CONSTRAINT ap_supplier_queries_supplier_id_parties_id_fk FOREIGN KEY (supplier_id) REFERENCES parties(id) ON DELETE SET NULL;
    ALTER TABLE payment_run_items ADD CONSTRAINT payment_run_items_supplier_id_parties_id_fk FOREIGN KEY (supplier_id) REFERENCES parties(id) ON DELETE SET NULL;

  END IF;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "parties_org_customer_code_unique" ON "parties" ("org_id","code") WHERE party_type = 'customer';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_parties_org_type" ON "parties" ("org_id","party_type");
--> statement-breakpoint

-- Compatibility views: exact original column names/order, so every existing
-- Drizzle query against "customers"/"ap_suppliers" is unaffected.
CREATE OR REPLACE VIEW "customers" AS SELECT
  id, org_id, name, code, country, currency, payment_terms, tax_number, risk_rating, status,
  credit_limit, account_owner_id, collection_owner_id, rep_id, region_id, notes, payment_method,
  phone, mobile, email, website, first_name, last_name, company_name,
  address_street, address_line2, address_city, address_state, address_postcode,
  qbo_id, xero_id, sage_intacct_id, chase_by_project, created_at, updated_at
FROM parties WHERE party_type = 'customer';
--> statement-breakpoint

CREATE OR REPLACE VIEW "ap_suppliers" AS SELECT
  id, org_id, name, display_name, code, email, phone, mobile, website, first_name, last_name,
  address, address_street, address_line2, address_city, address_state, address_postcode, country,
  currency, payment_terms, tax_number, status, risk_rating, notes, qbo_id, xero_id, sage_intacct_id,
  source, last_synced_at, created_at, updated_at
FROM parties WHERE party_type = 'supplier';
--> statement-breakpoint

-- INSTEAD OF triggers: forward INSERT/UPDATE/DELETE into parties, then
-- re-select through the view itself for the return row, so RETURNING/
-- .returning() gets exactly the view's shape by construction (no manual
-- column-order matching to get subtly wrong).
CREATE OR REPLACE FUNCTION customers_view_insert() RETURNS trigger AS $$
DECLARE v_id uuid;
BEGIN
  v_id := COALESCE(NEW.id, gen_random_uuid());
  INSERT INTO parties (
    id, org_id, party_type, name, code, country, currency, payment_terms, tax_number,
    risk_rating, status, credit_limit, account_owner_id, collection_owner_id, rep_id, region_id,
    notes, payment_method, phone, mobile, email, website, first_name, last_name, company_name,
    address_street, address_line2, address_city, address_state, address_postcode,
    qbo_id, xero_id, sage_intacct_id, chase_by_project, created_at, updated_at
  ) VALUES (
    v_id, NEW.org_id, 'customer', NEW.name, NEW.code, NEW.country,
    COALESCE(NEW.currency, 'EUR'), COALESCE(NEW.payment_terms, 30), NEW.tax_number,
    COALESCE(NEW.risk_rating, 'Low'), COALESCE(NEW.status, 'Active'), NEW.credit_limit,
    NEW.account_owner_id, NEW.collection_owner_id, NEW.rep_id, NEW.region_id,
    NEW.notes, NEW.payment_method, NEW.phone, NEW.mobile, NEW.email, NEW.website,
    NEW.first_name, NEW.last_name, NEW.company_name,
    NEW.address_street, NEW.address_line2, NEW.address_city, NEW.address_state, NEW.address_postcode,
    NEW.qbo_id, NEW.xero_id, NEW.sage_intacct_id, COALESCE(NEW.chase_by_project, false),
    COALESCE(NEW.created_at, now()), COALESCE(NEW.updated_at, now())
  );
  SELECT * INTO NEW FROM customers WHERE id = v_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION customers_view_update() RETURNS trigger AS $$
BEGIN
  UPDATE parties SET
    name = NEW.name, code = NEW.code, country = NEW.country, currency = NEW.currency,
    payment_terms = NEW.payment_terms, tax_number = NEW.tax_number, risk_rating = NEW.risk_rating,
    status = NEW.status, credit_limit = NEW.credit_limit, account_owner_id = NEW.account_owner_id,
    collection_owner_id = NEW.collection_owner_id, rep_id = NEW.rep_id, region_id = NEW.region_id,
    notes = NEW.notes, payment_method = NEW.payment_method, phone = NEW.phone, mobile = NEW.mobile,
    email = NEW.email, website = NEW.website, first_name = NEW.first_name, last_name = NEW.last_name,
    company_name = NEW.company_name, address_street = NEW.address_street, address_line2 = NEW.address_line2,
    address_city = NEW.address_city, address_state = NEW.address_state, address_postcode = NEW.address_postcode,
    qbo_id = NEW.qbo_id, xero_id = NEW.xero_id, sage_intacct_id = NEW.sage_intacct_id,
    chase_by_project = NEW.chase_by_project, updated_at = NEW.updated_at
  WHERE id = OLD.id AND party_type = 'customer';
  SELECT * INTO NEW FROM customers WHERE id = OLD.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION customers_view_delete() RETURNS trigger AS $$
BEGIN
  DELETE FROM parties WHERE id = OLD.id AND party_type = 'customer';
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION ap_suppliers_view_insert() RETURNS trigger AS $$
DECLARE v_id uuid;
BEGIN
  v_id := COALESCE(NEW.id, gen_random_uuid());
  INSERT INTO parties (
    id, org_id, party_type, name, display_name, code, email, phone, mobile, website,
    first_name, last_name, address, address_street, address_line2, address_city, address_state, address_postcode,
    country, currency, payment_terms, tax_number, status, risk_rating, notes,
    qbo_id, xero_id, sage_intacct_id, source, last_synced_at, created_at, updated_at
  ) VALUES (
    v_id, NEW.org_id, 'supplier', NEW.name, NEW.display_name, NEW.code, NEW.email, NEW.phone, NEW.mobile, NEW.website,
    NEW.first_name, NEW.last_name, NEW.address, NEW.address_street, NEW.address_line2, NEW.address_city, NEW.address_state, NEW.address_postcode,
    NEW.country, COALESCE(NEW.currency, 'EUR'), COALESCE(NEW.payment_terms, 30), NEW.tax_number,
    COALESCE(NEW.status, 'Active'), COALESCE(NEW.risk_rating, 'Low'), NEW.notes,
    NEW.qbo_id, NEW.xero_id, NEW.sage_intacct_id, COALESCE(NEW.source, 'native'), NEW.last_synced_at,
    COALESCE(NEW.created_at, now()), COALESCE(NEW.updated_at, now())
  );
  SELECT * INTO NEW FROM ap_suppliers WHERE id = v_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION ap_suppliers_view_update() RETURNS trigger AS $$
BEGIN
  UPDATE parties SET
    name = NEW.name, display_name = NEW.display_name, code = NEW.code, email = NEW.email,
    phone = NEW.phone, mobile = NEW.mobile, website = NEW.website, first_name = NEW.first_name,
    last_name = NEW.last_name, address = NEW.address, address_street = NEW.address_street,
    address_line2 = NEW.address_line2, address_city = NEW.address_city, address_state = NEW.address_state,
    address_postcode = NEW.address_postcode, country = NEW.country, currency = NEW.currency,
    payment_terms = NEW.payment_terms, tax_number = NEW.tax_number, status = NEW.status,
    risk_rating = NEW.risk_rating, notes = NEW.notes, qbo_id = NEW.qbo_id, xero_id = NEW.xero_id,
    sage_intacct_id = NEW.sage_intacct_id, source = NEW.source, last_synced_at = NEW.last_synced_at,
    updated_at = NEW.updated_at
  WHERE id = OLD.id AND party_type = 'supplier';
  SELECT * INTO NEW FROM ap_suppliers WHERE id = OLD.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION ap_suppliers_view_delete() RETURNS trigger AS $$
BEGIN
  DELETE FROM parties WHERE id = OLD.id AND party_type = 'supplier';
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS customers_insteadof_insert ON customers;
--> statement-breakpoint
CREATE TRIGGER customers_insteadof_insert INSTEAD OF INSERT ON customers FOR EACH ROW EXECUTE FUNCTION customers_view_insert();
--> statement-breakpoint
DROP TRIGGER IF EXISTS customers_insteadof_update ON customers;
--> statement-breakpoint
CREATE TRIGGER customers_insteadof_update INSTEAD OF UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION customers_view_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS customers_insteadof_delete ON customers;
--> statement-breakpoint
CREATE TRIGGER customers_insteadof_delete INSTEAD OF DELETE ON customers FOR EACH ROW EXECUTE FUNCTION customers_view_delete();
--> statement-breakpoint

DROP TRIGGER IF EXISTS ap_suppliers_insteadof_insert ON ap_suppliers;
--> statement-breakpoint
CREATE TRIGGER ap_suppliers_insteadof_insert INSTEAD OF INSERT ON ap_suppliers FOR EACH ROW EXECUTE FUNCTION ap_suppliers_view_insert();
--> statement-breakpoint
DROP TRIGGER IF EXISTS ap_suppliers_insteadof_update ON ap_suppliers;
--> statement-breakpoint
CREATE TRIGGER ap_suppliers_insteadof_update INSTEAD OF UPDATE ON ap_suppliers FOR EACH ROW EXECUTE FUNCTION ap_suppliers_view_update();
--> statement-breakpoint
DROP TRIGGER IF EXISTS ap_suppliers_insteadof_delete ON ap_suppliers;
--> statement-breakpoint
CREATE TRIGGER ap_suppliers_insteadof_delete INSTEAD OF DELETE ON ap_suppliers FOR EACH ROW EXECUTE FUNCTION ap_suppliers_view_delete();
