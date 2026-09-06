-- MIZAN: root-cause fixes for verified financial and meter-reading defects.
-- Scope:
--   1) Previous reading chain uses approved readings only.
--   2) Bill issuance prices from the historical tariff engine.
--   3) Previous outstanding balance is a snapshot, not a new ledger debit.
--   4) Bill ledger posting debits current-period charges only.
--   5) New bill status writes are normalized to the canonical vocabulary.
--
-- This migration intentionally does NOT rewrite historical financial rows.
-- Historical remediation requires a separate, evidence-based reconciliation.

-- ============================================================================
-- 1. Authoritative meter-reading chain: only approved readings may become the
--    previous reading for a new billing cycle.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_meter_reading_pipeline_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  _meter public.meters%ROWTYPE;
  _assignment public.meter_assignments%ROWTYPE;
  _previous NUMERIC;
  _average NUMERIC;
  _tenant UUID;
  _initial NUMERIC;
BEGIN
  PERFORM public.assert_authenticated_context();

  IF NEW.tenant_id IS NULL OR NEW.customer_id IS NULL OR NEW.meter_id IS NULL THEN
    RAISE EXCEPTION 'قراءة غير صالحة: المؤسسة والمشترك والعداد مطلوبة';
  END IF;

  IF NEW.client_uuid IS NULL THEN
    RAISE EXCEPTION 'قراءة غير صالحة: client_uuid مطلوب';
  END IF;

  IF NEW.photo_url IS NULL OR btrim(NEW.photo_url) = '' THEN
    RAISE EXCEPTION 'لا يمكن حفظ قراءة عداد بدون صورة أصلية موثقة';
  END IF;

  IF NEW.current_reading IS NULL OR NEW.current_reading < 0 THEN
    RAISE EXCEPTION 'القراءة الحالية غير صالحة';
  END IF;

  _tenant := public.current_tenant_id();

  IF NEW.tenant_id <> _tenant AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'المؤسسة الحالية لا تطابق القراءة';
  END IF;

  IF NOT (
    public.has_tenant_role(NEW.tenant_id, 'reader')
    OR public.has_tenant_role(NEW.tenant_id, 'manager')
  ) THEN
    RAISE EXCEPTION 'المستخدم غير مخول لتسجيل قراءة';
  END IF;

  SELECT *
  INTO _meter
  FROM public.meters
  WHERE id = NEW.meter_id
    AND tenant_id = NEW.tenant_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'العداد غير موجود أو لا يتبع المؤسسة الحالية';
  END IF;

  SELECT *
  INTO _assignment
  FROM public.meter_assignments
  WHERE tenant_id = NEW.tenant_id
    AND customer_id = NEW.customer_id
    AND meter_id = NEW.meter_id
    AND started_at::date <= COALESCE(NEW.reading_date, CURRENT_DATE)
    AND (ended_at IS NULL OR ended_at::date >= COALESCE(NEW.reading_date, CURRENT_DATE))
  ORDER BY started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'العداد غير مرتبط بالمشترك المحدد في تاريخ القراءة';
  END IF;

  IF NEW.photo_url !~ (
    '^tenants/' || NEW.tenant_id::text || '/readings/' ||
    NEW.client_uuid::text || '\.(jpg|png|webp)$'
  ) THEN
    RAISE EXCEPTION 'صورة الدليل غير مرتبطة بدورة القراءة الحالية';
  END IF;

  NEW.meter_number := _meter.serial;
  NEW.tenant_id := _meter.tenant_id;

  PERFORM public.acquire_customer_lock(NEW.tenant_id, NEW.customer_id);

  -- Root-cause fix: pending/suspicious readings are not authoritative history.
  SELECT wr.current_reading
  INTO _previous
  FROM public.water_readings wr
  WHERE wr.tenant_id = NEW.tenant_id
    AND wr.meter_id = NEW.meter_id
    AND wr.status = 'approved'
    AND wr.reading_date <= COALESCE(NEW.reading_date, CURRENT_DATE)
    AND (NEW.id IS NULL OR wr.id <> NEW.id)
  ORDER BY wr.reading_date DESC, wr.created_at DESC
  LIMIT 1;

  SELECT m.initial_index
  INTO _initial
  FROM public.meters m
  WHERE m.id = NEW.meter_id;

  NEW.previous := COALESCE(_previous, _initial, 0);
  NEW.consumption := GREATEST(NEW.current_reading - NEW.previous, 0);

  SELECT AVG(consumption)
  INTO _average
  FROM public.water_readings
  WHERE tenant_id = NEW.tenant_id
    AND meter_id = NEW.meter_id
    AND status = 'approved';

  IF NEW.current_reading < NEW.previous THEN
    NEW.consumption := 0;
    NEW.flag := 'error';
    NEW.status := 'pending_approval';
  ELSIF _average IS NOT NULL AND NEW.consumption > (_average * 3) THEN
    NEW.flag := 'suspicious';
    NEW.status := 'pending_approval';
  ELSE
    NEW.flag := COALESCE(NEW.flag, 'ok');
    NEW.status := COALESCE(NEW.status, 'approved');
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- 2. Bill issuance: current-period charge is priced historically; arrears are
--    a snapshot of the authoritative ledger and are not a second debit.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.issue_bill_for_reading(_reading public.water_readings)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  _current_charge NUMERIC(18,3);
  _arrears NUMERIC(18,3);
  _bill_id UUID;
  _tariff_version_id UUID;
  _reading_date DATE := COALESCE(_reading.reading_date, CURRENT_DATE);
BEGIN
  IF _reading.customer_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id
  INTO _bill_id
  FROM public.water_bills
  WHERE reading_id = _reading.id
  LIMIT 1;

  IF _bill_id IS NOT NULL THEN
    RETURN _bill_id;
  END IF;

  SELECT tv.id
  INTO _tariff_version_id
  FROM public.tariff_versions tv
  WHERE tv.tenant_id = _reading.tenant_id
    AND _reading_date >= tv.effective_from
    AND (tv.effective_to IS NULL OR _reading_date <= tv.effective_to)
  ORDER BY tv.effective_from DESC
  LIMIT 1;

  _current_charge := ROUND(
    public.price_consumption_historical(
      _reading.tenant_id,
      COALESCE(_reading.consumption, 0),
      _reading_date
    ),
    3
  );

  -- The ledger is the authoritative source for the prior outstanding balance.
  -- This snapshot is displayed on the invoice but must never be posted again.
  SELECT GREATEST(
    COALESCE(SUM(l.debit_amount - l.credit_amount), 0),
    0
  )
  INTO _arrears
  FROM public.customer_ledger l
  WHERE l.tenant_id = _reading.tenant_id
    AND l.customer_id = _reading.customer_id;

  INSERT INTO public.water_bills (
    tenant_id,
    customer_id,
    reading_id,
    amount,
    subtotal,
    arrears,
    arrears_snapshot,
    net_amount,
    total,
    status,
    issued_at,
    tariff_version_id
  )
  VALUES (
    _reading.tenant_id,
    _reading.customer_id,
    _reading.id,
    _current_charge,
    _current_charge,
    _arrears,
    _arrears,
    _current_charge,
    ROUND(_current_charge + _arrears, 3),
    'unpaid',
    NOW(),
    _tariff_version_id
  )
  RETURNING id INTO _bill_id;

  RETURN _bill_id;
END;
$$;

-- ============================================================================
-- 3. Ledger posting: post only the new economic charge for the billing period.
--    Previous arrears remain represented by their original immutable entries.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_post_bill_to_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  _debit NUMERIC(18,3);
  _display_arrears NUMERIC(18,3);
BEGIN
  IF COALESCE(NEW.status, 'unpaid') = 'void' OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  _display_arrears := GREATEST(
    COALESCE(NEW.arrears_snapshot, 0),
    COALESCE(NEW.arrears, 0)
  );

  _debit := ROUND(
    COALESCE(
      NULLIF(NEW.net_amount, 0),
      NULLIF(NEW.subtotal, 0),
      NULLIF(NEW.amount, 0),
      NULLIF(GREATEST(COALESCE(NEW.total, 0) - _display_arrears, 0), 0),
      0
    ),
    3
  );

  IF _debit > 0 THEN
    PERFORM public.acquire_customer_lock(NEW.tenant_id, NEW.customer_id);

    INSERT INTO public.customer_ledger (
      tenant_id,
      customer_id,
      entry_type,
      reference_id,
      debit_amount,
      credit_amount,
      running_balance,
      description,
      posted_at,
      created_at
    )
    VALUES (
      NEW.tenant_id,
      NEW.customer_id,
      'bill',
      NEW.id,
      _debit,
      0,
      0,
      FORMAT('إصدار رسوم دورة حالية بمبلغ %s', _debit),
      COALESCE(NEW.issued_at, NEW.created_at, NOW()),
      NOW()
    )
    ON CONFLICT (tenant_id, reference_id, entry_type) DO NOTHING;

    PERFORM public.recalc_customer_balance(NEW.customer_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_bill_to_ledger ON public.water_bills;
CREATE TRIGGER trg_post_bill_to_ledger
AFTER INSERT ON public.water_bills
FOR EACH ROW
EXECUTE FUNCTION public.tg_post_bill_to_ledger();

-- ============================================================================
-- 4. Canonical status vocabulary for future writes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.tg_normalize_water_bill_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'partially_paid' THEN
    NEW.status := 'partial';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_water_bill_status ON public.water_bills;
CREATE TRIGGER trg_normalize_water_bill_status
BEFORE INSERT OR UPDATE OF status ON public.water_bills
FOR EACH ROW
EXECUTE FUNCTION public.tg_normalize_water_bill_status();