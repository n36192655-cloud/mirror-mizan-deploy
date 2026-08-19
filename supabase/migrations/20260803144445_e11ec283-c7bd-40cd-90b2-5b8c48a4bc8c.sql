-- 1) super_admin inherits all tenant roles
CREATE OR REPLACE FUNCTION public.has_tenant_role(_tenant_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND tenant_id = _tenant_id
      AND (role = _role OR role = 'super_admin'::public.app_role)
  );
$fn$;

-- 2) ledger idempotency key
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_ledger_tenant_ref_type_key'
      AND conrelid = 'public.customer_ledger'::regclass
  ) THEN
    ALTER TABLE public.customer_ledger
      ADD CONSTRAINT customer_ledger_tenant_ref_type_key
      UNIQUE (tenant_id, reference_id, entry_type);
  END IF;
END
$do$;

-- 3) single canonical ledger posting helper
CREATE OR REPLACE FUNCTION public.post_ledger_entry(
  _tenant_id uuid, _customer_id uuid, _entry_type text, _reference_id uuid,
  _debit numeric, _credit numeric, _description text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp' AS $fn$
DECLARE _current numeric;
BEGIN
  IF _customer_id IS NULL OR _tenant_id IS NULL THEN RETURN; END IF;
  IF COALESCE(_debit,0) = 0 AND COALESCE(_credit,0) = 0 THEN RETURN; END IF;

  PERFORM public.acquire_customer_lock(_tenant_id, _customer_id);

  SELECT current_balance INTO _current FROM public.customer_balances
   WHERE tenant_id = _tenant_id AND customer_id = _customer_id;

  INSERT INTO public.customer_ledger (
    tenant_id, customer_id, entry_type, reference_id,
    debit_amount, credit_amount, running_balance, description
  ) VALUES (
    _tenant_id, _customer_id, _entry_type, _reference_id,
    ROUND(COALESCE(_debit,0),3), ROUND(COALESCE(_credit,0),3),
    COALESCE(_current,0) + ROUND(COALESCE(_debit,0),3) - ROUND(COALESCE(_credit,0),3),
    _description
  )
  ON CONFLICT (tenant_id, reference_id, entry_type) DO NOTHING;

  PERFORM public.recalc_customer_balance(_customer_id);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.post_ledger_entry(uuid,uuid,text,uuid,numeric,numeric,text) TO service_role;

-- 4) bills post a debit when issued
CREATE OR REPLACE FUNCTION public.issue_bill_for_reading(_reading public.water_readings)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _subtotal NUMERIC; _arrears NUMERIC; _bill_id UUID;
BEGIN
  IF _reading.customer_id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO _bill_id FROM public.water_bills WHERE reading_id = _reading.id LIMIT 1;
  IF _bill_id IS NOT NULL THEN RETURN _bill_id; END IF;

  _subtotal := public.price_consumption(_reading.tenant_id, COALESCE(_reading.consumption,0));

  SELECT COALESCE(SUM(GREATEST(total - paid_amount, 0)), 0) INTO _arrears
    FROM public.water_bills
   WHERE customer_id = _reading.customer_id AND status NOT IN ('paid','void');

  INSERT INTO public.water_bills (
    tenant_id, customer_id, reading_id, amount, subtotal, arrears,
    arrears_snapshot, total, net_amount, status, issued_at
  ) VALUES (
    _reading.tenant_id, _reading.customer_id, _reading.id,
    _subtotal, _subtotal, _arrears, _arrears, _subtotal, _subtotal, 'unpaid', now()
  ) RETURNING id INTO _bill_id;

  PERFORM public.post_ledger_entry(
    _reading.tenant_id, _reading.customer_id, 'bill', _bill_id,
    _subtotal, 0, 'Water bill'
  );

  RETURN _bill_id;
END;
$fn$;

-- 5) auto-approved readings must issue a bill too
CREATE OR REPLACE FUNCTION public.tg_reading_after_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.status = 'approved' THEN
    PERFORM public.issue_bill_for_reading(NEW);
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reading_after_insert ON public.water_readings;
CREATE TRIGGER trg_reading_after_insert
AFTER INSERT ON public.water_readings
FOR EACH ROW EXECUTE FUNCTION public.tg_reading_after_write();

-- 6) approved payments post a credit
CREATE OR REPLACE FUNCTION public.approve_payment(_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
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
  IF _bill.status = 'void' THEN RAISE EXCEPTION 'bill is void'; END IF;

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

  PERFORM public.post_ledger_entry(
    _pay.tenant_id, _bill.customer_id, 'payment', _pay.id,
    0, _pay.amount, 'Payment received'
  );

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, details)
  VALUES (_pay.tenant_id, _uid, 'payment.approve', 'payments', _pay.id,
          jsonb_build_object('amount', _pay.amount, 'bill_id', _bill.id));
END;
$fn$;

-- 7) voiding a bill reverses its ledger debit
CREATE OR REPLACE FUNCTION public.reject_reading(_reading_id uuid, _reason text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _r public.water_readings%ROWTYPE; _bill public.water_bills%ROWTYPE; _paid NUMERIC;
BEGIN
  SELECT * INTO _r FROM public.water_readings WHERE id = _reading_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reading not found'; END IF;
  IF NOT public.has_tenant_role(_r.tenant_id, 'manager') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _r.status = 'rejected' THEN RAISE EXCEPTION 'reading is already rejected'; END IF;

  SELECT * INTO _bill FROM public.water_bills WHERE reading_id = _reading_id FOR UPDATE;
  IF FOUND THEN
    SELECT COALESCE(SUM(amount),0) INTO _paid FROM public.payments
     WHERE bill_id = _bill.id AND status IN ('approved','pending');
    IF _paid > 0 THEN
      RAISE EXCEPTION 'cannot reject: bill already has payments';
    END IF;
    UPDATE public.water_bills SET status='void' WHERE id=_bill.id;
    PERFORM public.post_ledger_entry(
      _bill.tenant_id, _bill.customer_id, 'bill_void', _bill.id,
      0, _bill.total, 'Bill voided (reading rejected)'
    );
  END IF;

  UPDATE public.water_readings
     SET status='rejected', rejected_at=now(), rejected_by=auth.uid(), reject_reason=_reason
   WHERE id=_reading_id;

  IF _r.customer_id IS NOT NULL THEN PERFORM public.recalc_customer_balance(_r.customer_id); END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, details)
  VALUES (_r.tenant_id, auth.uid(), 'reading.reject', 'water_readings', _reading_id,
          jsonb_build_object('reason', _reason, 'voided_bill', _bill.id));
END;
$fn$;

-- 8) block payments inside a closed accounting period
CREATE OR REPLACE FUNCTION public.record_payment(_bill_id uuid, _amount numeric, _method text, _client_uuid text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
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
  IF _bill.status = 'void' THEN RAISE EXCEPTION 'bill is void'; END IF;

  IF NOT (public.has_tenant_role(_bill.tenant_id, 'collector')
          OR public.has_tenant_role(_bill.tenant_id, 'manager')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF public.is_period_closed(_bill.tenant_id, CURRENT_DATE) THEN
    RAISE EXCEPTION 'closed accounting period';
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

-- 9) frozen-invoice guard uses the real status vocabulary
CREATE OR REPLACE FUNCTION public.tg_protect_frozen_invoices()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp' AS $fn$
BEGIN
  IF OLD.status IN ('paid','partial','void')
     AND (
       ROUND(NEW.subtotal,3) IS DISTINCT FROM ROUND(OLD.subtotal,3)
       OR ROUND(NEW.total,3) IS DISTINCT FROM ROUND(OLD.total,3)
       OR ROUND(NEW.amount,3) IS DISTINCT FROM ROUND(OLD.amount,3)
     )
  THEN
    RAISE EXCEPTION 'Financial Security: Frozen invoices cannot be modified. Use billing_adjustments.';
  END IF;
  RETURN NEW;
END;
$fn$;

-- 10) adjustment approval referenced a role that does not exist in app_role
CREATE OR REPLACE FUNCTION public.tg_post_adjustment_to_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','pg_temp' AS $fn$
DECLARE _debit NUMERIC(18,3) := 0; _credit NUMERIC(18,3) := 0;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'approved' THEN
    IF NOT public.assert_tenant_role(NEW.tenant_id, ARRAY['super_admin','manager']) THEN
      RAISE EXCEPTION 'Only manager/super_admin can approve adjustments.';
    END IF;

    IF NEW.type = 'debit_note' THEN
      _debit := NEW.amount;
    ELSIF NEW.type IN ('credit_note','refund') THEN
      _credit := NEW.amount;
    END IF;

    PERFORM public.post_ledger_entry(
      NEW.tenant_id, NEW.customer_id, NEW.type, NEW.id, _debit, _credit, NEW.reason
    );
  END IF;
  RETURN NEW;
END;
$fn$;

-- 11) remove broken pricing function (referenced a non-existent tariffs.price column)
DROP FUNCTION IF EXISTS public.price_consumption_historical(uuid, numeric, date);

-- 12) rebuild all balances from the ledger
DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.customers LOOP
    PERFORM public.recalc_customer_balance(r.id);
  END LOOP;
END
$do$;