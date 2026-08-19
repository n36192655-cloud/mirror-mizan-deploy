-- ============================================================================
-- MIZAN — Critical hardening migration (Phase 0)
-- Apply this file inside your Supabase project (SQL Editor OR
-- `supabase db push` after moving it into `supabase/migrations/` with a
-- timestamp prefix).
--
-- What it fixes
--   1) Adds a real server-side lifecycle to payments (pending / approved /
--      rejected) — replaces the old client-only "status" flag.
--   2) Adds atomic RPCs (`record_payment`, `approve_payment`,
--      `reject_payment`) that lock the bill row FOR UPDATE, prevent
--      over-payment, and are idempotent on (tenant_id, client_uuid).
--   3) Adds CHECK constraints (`amount > 0`, valid status) and a unique
--      idempotency index.
--   4) Fixes the `device_sessions` read policy operator precedence bug that
--      let any authenticated user read every session in the database.
-- ============================================================================

-- ─── payments: lifecycle columns ────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS status        TEXT        NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by   UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by   UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reject_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_status_check') THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_status_check
      CHECK (status IN ('pending','approved','rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_amount_positive') THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);
  END IF;
END $$;

-- Same tenant + client_uuid ⇒ one payment row (retry-safe).
CREATE UNIQUE INDEX IF NOT EXISTS payments_tenant_client_uuid_uidx
  ON public.payments (tenant_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

-- ─── device_sessions read policy — fix operator precedence ─────────────────
DROP POLICY IF EXISTS "tenant read sessions" ON public.device_sessions;
CREATE POLICY "tenant read sessions" ON public.device_sessions FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      tenant_id = public.current_tenant_id()
      AND public.has_tenant_role(tenant_id, 'manager')
    )
  );

-- ─── record_payment(bill, amount, method, idempotency-key) ─────────────────
CREATE OR REPLACE FUNCTION public.record_payment(
  _bill_id     UUID,
  _amount      NUMERIC,
  _method      TEXT,
  _client_uuid TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _uid       UUID := auth.uid();
  _bill      public.water_bills%ROWTYPE;
  _approved  NUMERIC;
  _pending   NUMERIC;
  _remaining NUMERIC;
  _existing  UUID;
  _new_id    UUID;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;

  SELECT * INTO _bill FROM public.water_bills WHERE id = _bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill not found'; END IF;

  IF NOT (
    public.has_tenant_role(_bill.tenant_id, 'collector')
    OR public.has_tenant_role(_bill.tenant_id, 'manager')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO _existing FROM public.payments
     WHERE tenant_id = _bill.tenant_id AND client_uuid = _client_uuid;
    IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO _approved
    FROM public.payments WHERE bill_id = _bill.id AND status = 'approved';
  SELECT COALESCE(SUM(amount),0) INTO _pending
    FROM public.payments WHERE bill_id = _bill.id AND status = 'pending';

  _remaining := _bill.total - _approved - _pending;
  IF _amount > _remaining + 0.0001 THEN
    RAISE EXCEPTION 'amount exceeds remaining balance (%.2f)', _remaining;
  END IF;

  INSERT INTO public.payments (
    tenant_id, bill_id, customer_id, amount, method,
    client_uuid, status, created_by
  ) VALUES (
    _bill.tenant_id, _bill.id, _bill.customer_id, _amount,
    COALESCE(_method,'cash'), _client_uuid, 'pending', _uid
  )
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_payment(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

-- ─── approve_payment(payment) — manager only, atomic ───────────────────────
CREATE OR REPLACE FUNCTION public.approve_payment(_payment_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _uid        UUID := auth.uid();
  _pay        public.payments%ROWTYPE;
  _bill       public.water_bills%ROWTYPE;
  _approved   NUMERIC;
  _new_paid   NUMERIC;
  _new_status TEXT;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found'; END IF;
  IF _pay.status <> 'pending' THEN RAISE EXCEPTION 'payment is not pending'; END IF;
  IF _pay.bill_id IS NULL THEN RAISE EXCEPTION 'payment has no bill'; END IF;

  IF NOT (
    public.has_tenant_role(_pay.tenant_id, 'manager') OR public.is_super_admin()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO _bill FROM public.water_bills WHERE id = _pay.bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill not found'; END IF;

  SELECT COALESCE(SUM(amount),0) INTO _approved
    FROM public.payments WHERE bill_id = _bill.id AND status = 'approved';

  _new_paid := _approved + _pay.amount;
  IF _new_paid > _bill.total + 0.0001 THEN
    RAISE EXCEPTION 'approval would exceed bill total';
  END IF;

  _new_status := CASE
    WHEN _new_paid >= _bill.total - 0.0001 THEN 'paid'
    WHEN _new_paid > 0 THEN 'partial'
    ELSE 'unpaid'
  END;

  UPDATE public.payments
     SET status = 'approved', approved_at = now(), approved_by = _uid
   WHERE id = _pay.id;

  UPDATE public.water_bills
     SET paid_amount = _new_paid,
         status      = _new_status,
         paid_at     = CASE WHEN _new_status = 'paid' THEN now() ELSE paid_at END
   WHERE id = _bill.id;

  IF _bill.customer_id IS NOT NULL THEN
    UPDATE public.customers
       SET balance = GREATEST(0, balance - _pay.amount)
     WHERE id = _bill.customer_id;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.approve_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_payment(UUID) TO authenticated;

-- ─── reject_payment(payment, reason) — manager only ────────────────────────
CREATE OR REPLACE FUNCTION public.reject_payment(_payment_id UUID, _reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _uid UUID := auth.uid(); _pay public.payments%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found'; END IF;
  IF _pay.status <> 'pending' THEN RAISE EXCEPTION 'only pending payments can be rejected'; END IF;
  IF NOT (
    public.has_tenant_role(_pay.tenant_id, 'manager') OR public.is_super_admin()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.payments
     SET status = 'rejected', rejected_at = now(),
         rejected_by = _uid, reject_reason = _reason
   WHERE id = _pay.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_payment(UUID, TEXT) TO authenticated;
