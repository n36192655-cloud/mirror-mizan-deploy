-- 1. Remove duplicated triggers: keep exactly one BEFORE and one AFTER
DROP TRIGGER IF EXISTS trg_reading_before_insert ON public.water_readings;
DROP TRIGGER IF EXISTS trg_reading_after_insert ON public.water_readings;
DROP TRIGGER IF EXISTS trg_reading_after_approve ON public.water_readings;
DROP TRIGGER IF EXISTS trg_reading_after_write ON public.water_readings;

-- 2. Lifecycle columns
ALTER TABLE public.water_readings
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS reject_reason text;

-- 3. Idempotency for offline sync
CREATE UNIQUE INDEX IF NOT EXISTS water_readings_tenant_client_uuid_key
  ON public.water_readings (tenant_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

-- 4. Bills may be voided
ALTER TABLE public.water_bills DROP CONSTRAINT IF EXISTS water_bills_status_check;

CREATE OR REPLACE FUNCTION public.recalc_customer_balance(_customer_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bal NUMERIC;
BEGIN
  IF _customer_id IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(GREATEST(total - paid_amount, 0)), 0) INTO _bal
    FROM public.water_bills
   WHERE customer_id = _customer_id AND status NOT IN ('paid', 'void');
  UPDATE public.customers SET balance = _bal WHERE id = _customer_id;
  RETURN _bal;
END; $$;

-- arrears must ignore voided bills too
CREATE OR REPLACE FUNCTION public.issue_bill_for_reading(_reading water_readings)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    tenant_id, customer_id, reading_id, amount, subtotal, arrears, total, status, issued_at
  ) VALUES (
    _reading.tenant_id, _reading.customer_id, _reading.id,
    _subtotal, _subtotal, _arrears, _subtotal, 'unpaid', now()
  ) RETURNING id INTO _bill_id;

  PERFORM public.recalc_customer_balance(_reading.customer_id);
  RETURN _bill_id;
END; $$;

-- 5. Previous-index resolution honours backdated readings
CREATE OR REPLACE FUNCTION public.tg_reading_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _prev NUMERIC; _avg NUMERIC; _init NUMERIC; _started TIMESTAMPTZ;
  _cust UUID; _tid UUID; _later INT;
BEGIN
  IF NEW.meter_id IS NULL THEN RAISE EXCEPTION 'meter_id is required'; END IF;

  SELECT tenant_id, initial_index INTO _tid, _init FROM public.meters WHERE id = NEW.meter_id;
  IF _tid IS NULL THEN RAISE EXCEPTION 'meter not found'; END IF;
  NEW.tenant_id := _tid;

  SELECT customer_id, started_at INTO _cust, _started
    FROM public.meter_assignments
   WHERE meter_id = NEW.meter_id
     AND started_at <= (NEW.reading_date + 1)::timestamptz
     AND (ended_at IS NULL OR ended_at >= NEW.reading_date::timestamptz)
   ORDER BY started_at DESC LIMIT 1;
  NEW.customer_id := _cust;

  -- previous index: latest non-rejected reading of this meter strictly before
  -- this reading's date, inside the current assignment window
  SELECT current_reading INTO _prev FROM public.water_readings
   WHERE meter_id = NEW.meter_id
     AND status <> 'rejected'
     AND reading_date <= NEW.reading_date
     AND (_started IS NULL OR created_at >= _started)
   ORDER BY reading_date DESC, created_at DESC LIMIT 1;
  NEW.previous := COALESCE(NEW.previous, _prev, _init, 0);

  NEW.consumption := GREATEST(NEW.current_reading - COALESCE(NEW.previous, 0), 0);

  SELECT count(*) INTO _later FROM public.water_readings
   WHERE meter_id = NEW.meter_id AND status <> 'rejected'
     AND reading_date > NEW.reading_date;

  SELECT AVG(consumption) INTO _avg FROM public.water_readings
   WHERE meter_id = NEW.meter_id AND status = 'approved';

  IF NEW.current_reading < COALESCE(NEW.previous, 0) THEN
    NEW.flag := 'error'; NEW.status := 'pending_approval';
  ELSIF _later > 0 THEN
    NEW.flag := 'backdated'; NEW.status := 'pending_approval';
  ELSIF _avg IS NOT NULL AND _avg > 0 AND NEW.consumption > _avg * 3 THEN
    NEW.flag := 'suspicious'; NEW.status := 'pending_approval';
  ELSE
    NEW.flag := COALESCE(NEW.flag, 'ok'); NEW.status := 'approved';
  END IF;

  IF NEW.status = 'approved' THEN
    NEW.approved_at := now(); NEW.approved_by := auth.uid();
  END IF;
  RETURN NEW;
END; $$;

-- 6. Status transition guard
CREATE OR REPLACE FUNCTION public.tg_reading_status_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'pending_approval' AND NEW.status IN ('approved','rejected'))
      OR (OLD.status = 'approved' AND NEW.status = 'rejected')
    ) THEN
      RAISE EXCEPTION 'invalid reading status transition % -> %', OLD.status, NEW.status;
    END IF;
  END IF;
  IF NEW.meter_id IS DISTINCT FROM OLD.meter_id THEN
    RAISE EXCEPTION 'reading meter cannot be changed';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_reading_status_guard ON public.water_readings;
CREATE TRIGGER trg_reading_status_guard BEFORE UPDATE ON public.water_readings
FOR EACH ROW EXECUTE FUNCTION public.tg_reading_status_guard();

-- 7. Approve / reject with audit trail
CREATE OR REPLACE FUNCTION public.approve_reading(_reading_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.water_readings%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM public.water_readings WHERE id = _reading_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reading not found'; END IF;
  IF NOT public.has_tenant_role(_r.tenant_id, 'manager') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _r.status <> 'pending_approval' THEN RAISE EXCEPTION 'reading is not pending approval'; END IF;

  UPDATE public.water_readings
     SET status='approved', approved_at=now(), approved_by=auth.uid()
   WHERE id=_reading_id;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, details)
  VALUES (_r.tenant_id, auth.uid(), 'reading.approve', 'water_readings', _reading_id,
          jsonb_build_object('flag', _r.flag, 'consumption', _r.consumption));
END; $$;

CREATE OR REPLACE FUNCTION public.reject_reading(_reading_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  END IF;

  UPDATE public.water_readings
     SET status='rejected', rejected_at=now(), rejected_by=auth.uid(), reject_reason=_reason
   WHERE id=_reading_id;

  IF _r.customer_id IS NOT NULL THEN PERFORM public.recalc_customer_balance(_r.customer_id); END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, details)
  VALUES (_r.tenant_id, auth.uid(), 'reading.reject', 'water_readings', _reading_id,
          jsonb_build_object('reason', _reason, 'voided_bill', _bill.id));
END; $$;

-- 8. Audit trail for meter lifecycle operations
CREATE OR REPLACE FUNCTION public.assign_meter(_customer_id uuid, _serial text, _meter_type text DEFAULT 'water', _initial_index numeric DEFAULT 0, _installed_at date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid UUID; _serial_n TEXT; _meter_id UUID; _open UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  _serial_n := upper(btrim(COALESCE(_serial, '')));
  IF _serial_n = '' THEN RAISE EXCEPTION 'serial is required'; END IF;

  SELECT tenant_id INTO _tid FROM public.customers WHERE id = _customer_id;
  IF _tid IS NULL THEN RAISE EXCEPTION 'customer not found'; END IF;
  IF NOT public.has_tenant_role(_tid, 'manager') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT id INTO _meter_id FROM public.meters
   WHERE tenant_id = _tid AND upper(btrim(serial)) = _serial_n;

  IF _meter_id IS NULL THEN
    INSERT INTO public.meters (tenant_id, serial, meter_type, initial_index, installed_at, created_by)
    VALUES (_tid, _serial_n, COALESCE(_meter_type,'water'), COALESCE(_initial_index,0), _installed_at, auth.uid())
    RETURNING id INTO _meter_id;
  END IF;

  SELECT id INTO _open FROM public.meter_assignments
   WHERE meter_id = _meter_id AND ended_at IS NULL;
  IF _open IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.meter_assignments WHERE id = _open AND customer_id = _customer_id) THEN
      RETURN _meter_id;
    END IF;
    RAISE EXCEPTION 'meter % is already assigned to another customer', _serial_n;
  END IF;

  UPDATE public.meter_assignments
     SET ended_at = now(), end_reason = 'reassigned'
   WHERE customer_id = _customer_id AND ended_at IS NULL;

  INSERT INTO public.meter_assignments (tenant_id, meter_id, customer_id, created_by)
  VALUES (_tid, _meter_id, _customer_id, auth.uid());

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, details)
  VALUES (_tid, auth.uid(), 'meter.assign', 'meters', _meter_id,
          jsonb_build_object('serial', _serial_n, 'customer_id', _customer_id));

  RETURN _meter_id;
END; $$;

CREATE OR REPLACE FUNCTION public.unassign_meter(_customer_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid UUID; _meter UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT tenant_id INTO _tid FROM public.customers WHERE id = _customer_id;
  IF _tid IS NULL THEN RAISE EXCEPTION 'customer not found'; END IF;
  IF NOT public.has_tenant_role(_tid, 'manager') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT meter_id INTO _meter FROM public.meter_assignments
   WHERE customer_id = _customer_id AND ended_at IS NULL;

  UPDATE public.meter_assignments
     SET ended_at = now(), end_reason = COALESCE(_reason, 'unassigned')
   WHERE customer_id = _customer_id AND ended_at IS NULL;

  IF _meter IS NOT NULL THEN
    INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, details)
    VALUES (_tid, auth.uid(), 'meter.unassign', 'meters', _meter,
            jsonb_build_object('customer_id', _customer_id, 'reason', _reason));
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.replace_meter(_customer_id uuid, _new_serial text, _new_initial_index numeric DEFAULT 0, _old_meter_status text DEFAULT 'removed', _reason text DEFAULT 'replaced')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid UUID; _old_meter UUID; _new_meter UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT tenant_id INTO _tid FROM public.customers WHERE id = _customer_id;
  IF _tid IS NULL THEN RAISE EXCEPTION 'customer not found'; END IF;
  IF NOT public.has_tenant_role(_tid, 'manager') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT meter_id INTO _old_meter FROM public.meter_assignments
   WHERE customer_id = _customer_id AND ended_at IS NULL;

  UPDATE public.meter_assignments
     SET ended_at = now(), end_reason = COALESCE(_reason, 'replaced')
   WHERE customer_id = _customer_id AND ended_at IS NULL;

  IF _old_meter IS NOT NULL THEN
    UPDATE public.meters SET status = COALESCE(_old_meter_status, 'removed') WHERE id = _old_meter;
  END IF;

  _new_meter := public.assign_meter(_customer_id, _new_serial, 'water', COALESCE(_new_initial_index, 0), CURRENT_DATE);

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, details)
  VALUES (_tid, auth.uid(), 'meter.replace', 'meters', _new_meter,
          jsonb_build_object('customer_id', _customer_id, 'old_meter_id', _old_meter, 'reason', _reason));

  RETURN _new_meter;
END; $$;