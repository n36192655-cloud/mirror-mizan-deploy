-- ============ 1) payments lifecycle ============
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by   UUID,
  ADD COLUMN IF NOT EXISTS rejected_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by   UUID,
  ADD COLUMN IF NOT EXISTS reject_reason TEXT;

-- historical seed payments are settled money
UPDATE public.payments SET status = 'approved', approved_at = COALESCE(approved_at, paid_at)
 WHERE status = 'pending' AND created_at < now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_status_check') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
      CHECK (status IN ('pending','approved','rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_amount_positive') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS payments_tenant_client_uuid_uidx
  ON public.payments (tenant_id, client_uuid) WHERE client_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_bill_status_idx ON public.payments (bill_id, status);

-- ============ 2) device_sessions policy precedence fix ============
DROP POLICY IF EXISTS "tenant read sessions" ON public.device_sessions;
CREATE POLICY "tenant read sessions" ON public.device_sessions FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_tenant_role(tenant_id, 'manager'));

-- ============ 3) tiered pricing helper ============
CREATE OR REPLACE FUNCTION public.price_consumption(_tenant_id UUID, _consumption NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _tariff public.tariffs%ROWTYPE;
  _rem NUMERIC := GREATEST(COALESCE(_consumption,0), 0);
  _prev NUMERIC := 0;
  _total NUMERIC := 0;
  _slice NUMERIC;
  t RECORD;
BEGIN
  SELECT * INTO _tariff FROM public.tariffs
   WHERE tenant_id = _tenant_id AND is_active ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN ROUND(_rem * 100, 2); END IF;
  _total := COALESCE(_tariff.fixed_fee, 0);
  FOR t IN SELECT * FROM public.tariff_tiers WHERE tariff_id = _tariff.id ORDER BY tier_order LOOP
    EXIT WHEN _rem <= 0;
    _slice := CASE WHEN t.upper_bound IS NULL THEN _rem
                   ELSE LEAST(_rem, GREATEST(t.upper_bound - _prev, 0)) END;
    _total := _total + _slice * t.rate_per_m3;
    _rem := _rem - _slice;
    _prev := COALESCE(t.upper_bound, _prev + _slice);
  END LOOP;
  RETURN ROUND(_total, 2);
END;
$fn$;
REVOKE ALL ON FUNCTION public.price_consumption(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.price_consumption(UUID, NUMERIC) TO authenticated, service_role;

-- ============ 4) bill issuance from a reading ============
CREATE OR REPLACE FUNCTION public.issue_bill_for_reading(_reading public.water_readings)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _subtotal NUMERIC; _arrears NUMERIC; _bill_id UUID;
BEGIN
  IF _reading.customer_id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO _bill_id FROM public.water_bills WHERE reading_id = _reading.id LIMIT 1;
  IF _bill_id IS NOT NULL THEN RETURN _bill_id; END IF;

  _subtotal := public.price_consumption(_reading.tenant_id, COALESCE(_reading.consumption,0));
  SELECT COALESCE(SUM(GREATEST(subtotal - paid_amount, 0)), 0) INTO _arrears
    FROM public.water_bills
   WHERE customer_id = _reading.customer_id AND status <> 'paid';

  INSERT INTO public.water_bills (
    tenant_id, customer_id, reading_id, amount, subtotal, arrears, total, status, issued_at
  ) VALUES (
    _reading.tenant_id, _reading.customer_id, _reading.id,
    _subtotal, _subtotal, _arrears, _subtotal + _arrears, 'unpaid', now()
  ) RETURNING id INTO _bill_id;

  UPDATE public.customers SET balance = balance + _subtotal WHERE id = _reading.customer_id;
  RETURN _bill_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_bill_for_reading(public.water_readings) FROM PUBLIC, anon;

-- ============ 5) reading triggers: derive + auto-bill ============
CREATE OR REPLACE FUNCTION public.tg_reading_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _prev NUMERIC; _avg NUMERIC;
BEGIN
  IF NEW.previous IS NULL THEN
    SELECT current_reading INTO _prev FROM public.water_readings
     WHERE tenant_id = NEW.tenant_id AND meter_number = NEW.meter_number
       AND status <> 'rejected'
     ORDER BY reading_date DESC, created_at DESC LIMIT 1;
    NEW.previous := COALESCE(_prev, 0);
  END IF;
  NEW.consumption := GREATEST(NEW.current_reading - COALESCE(NEW.previous,0), 0);

  SELECT AVG(consumption) INTO _avg FROM public.water_readings
   WHERE tenant_id = NEW.tenant_id AND meter_number = NEW.meter_number AND status = 'approved';

  IF NEW.current_reading < COALESCE(NEW.previous,0) THEN
    NEW.flag := 'error'; NEW.status := 'pending_approval';
  ELSIF _avg IS NOT NULL AND _avg > 0 AND NEW.consumption > _avg * 3 THEN
    NEW.flag := 'suspicious'; NEW.status := 'pending_approval';
  ELSE
    NEW.flag := COALESCE(NEW.flag, 'ok'); NEW.status := 'approved';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.tg_reading_after_write()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NEW.status = 'approved' THEN PERFORM public.issue_bill_for_reading(NEW); END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reading_before_insert ON public.water_readings;
CREATE TRIGGER trg_reading_before_insert BEFORE INSERT ON public.water_readings
  FOR EACH ROW EXECUTE FUNCTION public.tg_reading_before_insert();

DROP TRIGGER IF EXISTS trg_reading_after_insert ON public.water_readings;
CREATE TRIGGER trg_reading_after_insert AFTER INSERT ON public.water_readings
  FOR EACH ROW EXECUTE FUNCTION public.tg_reading_after_write();

DROP TRIGGER IF EXISTS trg_reading_after_approve ON public.water_readings;
CREATE TRIGGER trg_reading_after_approve AFTER UPDATE OF status ON public.water_readings
  FOR EACH ROW WHEN (OLD.status <> 'approved' AND NEW.status = 'approved')
  EXECUTE FUNCTION public.tg_reading_after_write();

DROP TRIGGER IF EXISTS trg_readings_touch ON public.water_readings;
CREATE TRIGGER trg_readings_touch BEFORE UPDATE ON public.water_readings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ============ 6) payment RPCs ============
CREATE OR REPLACE FUNCTION public.record_payment(
  _bill_id UUID, _amount NUMERIC, _method TEXT, _client_uuid TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _uid UUID := auth.uid();
  _bill public.water_bills%ROWTYPE;
  _approved NUMERIC; _pending NUMERIC; _remaining NUMERIC;
  _existing UUID; _new_id UUID;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;

  SELECT * INTO _bill FROM public.water_bills WHERE id = _bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill not found'; END IF;

  IF NOT (public.has_tenant_role(_bill.tenant_id, 'collector')
          OR public.has_tenant_role(_bill.tenant_id, 'manager')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _client_uuid IS NOT NULL THEN
    SELECT id INTO _existing FROM public.payments
     WHERE tenant_id = _bill.tenant_id AND client_uuid = _client_uuid;
    IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  END IF;

  SELECT COALESCE(SUM(amount),0) INTO _approved FROM public.payments
   WHERE bill_id = _bill.id AND status = 'approved';
  SELECT COALESCE(SUM(amount),0) INTO _pending FROM public.payments
   WHERE bill_id = _bill.id AND status = 'pending';

  _remaining := _bill.total - _approved - _pending;
  IF _amount > _remaining + 0.0001 THEN
    RAISE EXCEPTION 'amount exceeds remaining balance (%)', ROUND(_remaining, 2);
  END IF;

  INSERT INTO public.payments (tenant_id, bill_id, customer_id, amount, method, client_uuid, status, created_by)
  VALUES (_bill.tenant_id, _bill.id, _bill.customer_id, _amount, COALESCE(_method,'cash'), _client_uuid, 'pending', _uid)
  RETURNING id INTO _new_id;
  RETURN _new_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.record_payment(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_payment(_payment_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _uid UUID := auth.uid();
  _pay public.payments%ROWTYPE; _bill public.water_bills%ROWTYPE;
  _approved NUMERIC; _new_paid NUMERIC; _new_status TEXT;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found'; END IF;
  IF _pay.status <> 'pending' THEN RAISE EXCEPTION 'payment is not pending'; END IF;
  IF _pay.bill_id IS NULL THEN RAISE EXCEPTION 'payment has no bill'; END IF;
  IF NOT public.has_tenant_role(_pay.tenant_id, 'manager') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO _bill FROM public.water_bills WHERE id = _pay.bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill not found'; END IF;

  SELECT COALESCE(SUM(amount),0) INTO _approved FROM public.payments
   WHERE bill_id = _bill.id AND status = 'approved';
  _new_paid := _approved + _pay.amount;
  IF _new_paid > _bill.total + 0.0001 THEN RAISE EXCEPTION 'approval would exceed bill total'; END IF;

  _new_status := CASE WHEN _new_paid >= _bill.total - 0.0001 THEN 'paid'
                      WHEN _new_paid > 0 THEN 'partial' ELSE 'unpaid' END;

  UPDATE public.payments SET status='approved', approved_at=now(), approved_by=_uid WHERE id=_pay.id;
  UPDATE public.water_bills
     SET paid_amount=_new_paid, status=_new_status,
         paid_at = CASE WHEN _new_status='paid' THEN now() ELSE paid_at END
   WHERE id=_bill.id;
  IF _bill.customer_id IS NOT NULL THEN
    UPDATE public.customers SET balance = GREATEST(0, balance - _pay.amount) WHERE id = _bill.customer_id;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.approve_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_payment(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_payment(_payment_id UUID, _reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _uid UUID := auth.uid(); _pay public.payments%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found'; END IF;
  IF _pay.status <> 'pending' THEN RAISE EXCEPTION 'only pending payments can be rejected'; END IF;
  IF NOT public.has_tenant_role(_pay.tenant_id, 'manager') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.payments SET status='rejected', rejected_at=now(), rejected_by=_uid, reject_reason=_reason
   WHERE id=_pay.id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reject_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_payment(UUID, TEXT) TO authenticated;

-- ============ 7) reconciliation of existing data ============
UPDATE public.water_bills b SET
  paid_amount = agg.paid,
  status = CASE WHEN agg.paid >= b.total - 0.0001 THEN 'paid'
                WHEN agg.paid > 0 THEN 'partial' ELSE 'unpaid' END,
  paid_at = CASE WHEN agg.paid >= b.total - 0.0001 THEN COALESCE(b.paid_at, now()) ELSE NULL END
FROM (
  SELECT wb.id, COALESCE(SUM(p.amount) FILTER (WHERE p.status='approved'), 0) AS paid
    FROM public.water_bills wb
    LEFT JOIN public.payments p ON p.bill_id = wb.id
   GROUP BY wb.id
) agg
WHERE b.id = agg.id;

UPDATE public.customers c SET balance = COALESCE(agg.due, 0)
FROM (
  SELECT cu.id, COALESCE(SUM(GREATEST(wb.subtotal - wb.paid_amount, 0)), 0) AS due
    FROM public.customers cu
    LEFT JOIN public.water_bills wb ON wb.customer_id = cu.id
   GROUP BY cu.id
) agg
WHERE c.id = agg.id;