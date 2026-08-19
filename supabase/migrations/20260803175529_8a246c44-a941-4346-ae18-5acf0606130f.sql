-- 1) Bill status must allow 'void' (functions already produce it)
ALTER TABLE public.water_bills DROP CONSTRAINT IF EXISTS water_bills_status_check;
ALTER TABLE public.water_bills
  ADD CONSTRAINT water_bills_status_check
  CHECK (status = ANY (ARRAY['paid'::text,'partial'::text,'unpaid'::text,'void'::text]));

-- 2) Accounting sanity constraints
ALTER TABLE public.water_bills DROP CONSTRAINT IF EXISTS water_bills_amounts_nonneg;
ALTER TABLE public.water_bills
  ADD CONSTRAINT water_bills_amounts_nonneg
  CHECK (total >= 0 AND paid_amount >= 0 AND paid_amount <= total + 0.0001);

-- 3) Performance indexes for bill listings / per-customer lookups
CREATE INDEX IF NOT EXISTS water_bills_tenant_created_idx
  ON public.water_bills (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS water_bills_customer_status_idx
  ON public.water_bills (tenant_id, customer_id, status);

-- 4) Realtime: full row images + publication membership
ALTER TABLE public.customers REPLICA IDENTITY FULL;
ALTER TABLE public.water_readings REPLICA IDENTITY FULL;
ALTER TABLE public.water_bills REPLICA IDENTITY FULL;
ALTER TABLE public.payments REPLICA IDENTITY FULL;
ALTER TABLE public.customer_ledger REPLICA IDENTITY FULL;
ALTER TABLE public.customer_balances REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers','water_readings','water_bills','payments','customer_ledger','customer_balances']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;