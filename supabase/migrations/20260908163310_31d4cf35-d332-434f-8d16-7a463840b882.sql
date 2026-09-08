CREATE OR REPLACE FUNCTION public.tg_meter_reading_pipeline_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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

  SELECT * INTO _meter
  FROM public.meters
  WHERE id = NEW.meter_id AND tenant_id = NEW.tenant_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'العداد غير موجود أو لا يتبع المؤسسة الحالية';
  END IF;

  SELECT * INTO _assignment
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

  NEW.tenant_id := _meter.tenant_id;

  PERFORM public.acquire_customer_lock(NEW.tenant_id, NEW.customer_id);

  SELECT wr.current_reading INTO _previous
  FROM public.water_readings wr
  WHERE wr.tenant_id = NEW.tenant_id
    AND wr.meter_id = NEW.meter_id
    AND wr.status = 'approved'
    AND wr.reading_date <= COALESCE(NEW.reading_date, CURRENT_DATE)
    AND (NEW.id IS NULL OR wr.id <> NEW.id)
  ORDER BY wr.reading_date DESC, wr.created_at DESC
  LIMIT 1;

  SELECT m.initial_index INTO _initial
  FROM public.meters m WHERE m.id = NEW.meter_id;

  NEW.previous := COALESCE(_previous, _initial, 0);
  NEW.consumption := GREATEST(NEW.current_reading - NEW.previous, 0);

  SELECT AVG(consumption) INTO _average
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
$function$;

CREATE TABLE IF NOT EXISTS public.reading_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  client_uuid text NOT NULL,
  meter_id uuid REFERENCES public.meters(id),
  attempt_no integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('OCR_FAILED', 'OCR_SUCCESS')),
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, client_uuid, attempt_no)
);

GRANT SELECT, INSERT ON public.reading_attempts TO authenticated;
GRANT ALL ON public.reading_attempts TO service_role;

ALTER TABLE public.reading_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reading_attempts_select_own_tenant ON public.reading_attempts;
CREATE POLICY reading_attempts_select_own_tenant
  ON public.reading_attempts FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS reading_attempts_insert_own_tenant ON public.reading_attempts;
CREATE POLICY reading_attempts_insert_own_tenant
  ON public.reading_attempts FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (
      public.has_tenant_role(tenant_id, 'reader')
      OR public.has_tenant_role(tenant_id, 'manager')
    )
  );

CREATE INDEX IF NOT EXISTS reading_attempts_lookup_idx
  ON public.reading_attempts (tenant_id, client_uuid, outcome);

CREATE OR REPLACE FUNCTION public.record_reading_attempt(
  p_tenant_id uuid,
  p_client_uuid text,
  p_meter_id uuid,
  p_outcome text,
  p_reason text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  _outcome text := upper(coalesce(p_outcome, ''));
  _next integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'المستخدم غير مصادق عليه';
  END IF;
  IF _outcome NOT IN ('OCR_FAILED', 'OCR_SUCCESS') THEN
    RAISE EXCEPTION 'نتيجة المحاولة غير صالحة';
  END IF;
  IF p_client_uuid IS NULL OR btrim(p_client_uuid) = '' THEN
    RAISE EXCEPTION 'client_uuid مطلوب';
  END IF;
  IF public.current_tenant_id() IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'المؤسسة الحالية لا تطابق المحاولة';
  END IF;
  IF NOT (
    public.has_tenant_role(p_tenant_id, 'reader')
    OR public.has_tenant_role(p_tenant_id, 'manager')
  ) THEN
    RAISE EXCEPTION 'المستخدم غير مخول لتسجيل محاولة قراءة';
  END IF;

  SELECT COALESCE(MAX(attempt_no), 0) + 1 INTO _next
  FROM public.reading_attempts
  WHERE tenant_id = p_tenant_id AND client_uuid = p_client_uuid;

  IF _next > 3 THEN
    RAISE EXCEPTION 'تم استنفاد محاولات القراءة الآلية الثلاث لهذه الدورة';
  END IF;

  INSERT INTO public.reading_attempts (
    tenant_id, client_uuid, meter_id, attempt_no, outcome, reason, created_by
  ) VALUES (
    p_tenant_id, p_client_uuid, p_meter_id, _next, _outcome,
    nullif(btrim(coalesce(p_reason, '')), ''), auth.uid()
  );

  RETURN _next;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_reading_attempt(uuid, text, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.insert_meter_reading_with_provenance(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_meter_id uuid,
  p_current_reading numeric,
  p_reading_date date,
  p_client_uuid text,
  p_photo_url text,
  p_lat numeric,
  p_lng numeric,
  p_gps_verified boolean,
  p_reading_source text,
  p_attempt_count integer,
  p_failure_reason text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  _reading_id uuid;
  _source text := upper(coalesce(p_reading_source, ''));
  _previous numeric;
  _failed integer;
  _succeeded integer;
  _attempts integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'المستخدم غير مصادق عليه'; END IF;
  IF _source NOT IN ('OCR', 'MANUAL_FALLBACK') THEN RAISE EXCEPTION 'مصدر القراءة غير صالح'; END IF;

  SELECT
    count(*) FILTER (WHERE outcome = 'OCR_FAILED'),
    count(*) FILTER (WHERE outcome = 'OCR_SUCCESS')
  INTO _failed, _succeeded
  FROM public.reading_attempts
  WHERE tenant_id = p_tenant_id AND client_uuid = p_client_uuid;

  _attempts := LEAST(GREATEST(COALESCE(_failed, 0) + COALESCE(_succeeded, 0), 1), 3);

  IF _source = 'MANUAL_FALLBACK' THEN
    IF COALESCE(_failed, 0) < 3 THEN
      RAISE EXCEPTION 'الإدخال اليدوي مسموح فقط بعد ثلاث محاولات قراءة آلية فاشلة مسجلة على السيرفر';
    END IF;
    IF nullif(btrim(coalesce(p_failure_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'سبب فشل القراءة الآلية مطلوب للإدخال اليدوي';
    END IF;
    _attempts := 3;
  ELSE
    IF COALESCE(_succeeded, 0) < 1 THEN
      RAISE EXCEPTION 'قراءة OCR تتطلب محاولة آلية ناجحة مسجلة على السيرفر';
    END IF;
  END IF;

  SELECT current_reading INTO _previous
  FROM public.water_readings
  WHERE tenant_id = p_tenant_id AND meter_id = p_meter_id
    AND status <> 'rejected' AND reading_date <= p_reading_date
  ORDER BY reading_date DESC, created_at DESC
  LIMIT 1;

  IF _previous IS NOT NULL AND p_current_reading < _previous THEN
    RAISE EXCEPTION 'القراءة الحالية أقل من القراءة السابقة';
  END IF;

  _reading_id := public.insert_verified_meter_reading(
    p_tenant_id, p_customer_id, p_meter_id, p_current_reading, p_reading_date,
    p_client_uuid, p_photo_url, p_lat, p_lng, p_gps_verified
  );

  UPDATE public.water_readings
  SET reading_source = _source,
      attempt_count = _attempts,
      failure_reason = nullif(btrim(coalesce(p_failure_reason, '')), ''),
      verified_at = CASE WHEN _source = 'OCR' THEN now() ELSE NULL END
  WHERE id = _reading_id AND tenant_id = p_tenant_id;

  RETURN _reading_id;
END;
$function$;

CREATE UNIQUE INDEX IF NOT EXISTS water_readings_tenant_client_uuid_key
  ON public.water_readings (tenant_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

DROP POLICY IF EXISTS "Meter readings storage upload policy" ON storage.objects;
DROP POLICY IF EXISTS "Meter readings storage read policy" ON storage.objects;
DROP POLICY IF EXISTS "Meter readings storage update policy" ON storage.objects;
DROP POLICY IF EXISTS "Meter readings storage delete policy" ON storage.objects;

DROP POLICY IF EXISTS meter_readings_read_own_tenant ON storage.objects;
DROP POLICY IF EXISTS meter_readings_insert_own_tenant ON storage.objects;
DROP POLICY IF EXISTS meter_readings_update_own_tenant ON storage.objects;
DROP POLICY IF EXISTS meter_readings_delete_own_tenant ON storage.objects;

CREATE POLICY meter_readings_read_own_tenant
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'meter-readings'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public.current_tenant_id()::text
    AND (storage.foldername(name))[3] = 'readings'
  );

CREATE POLICY meter_readings_insert_own_tenant
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'meter-readings'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public.current_tenant_id()::text
    AND (storage.foldername(name))[3] = 'readings'
    AND name ~ '^tenants/[0-9a-fA-F-]{36}/readings/[0-9a-zA-Z_-]+\.(jpg|png|webp)$'
  );

CREATE POLICY meter_readings_update_own_tenant
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'meter-readings'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public.current_tenant_id()::text
    AND (storage.foldername(name))[3] = 'readings'
  )
  WITH CHECK (
    bucket_id = 'meter-readings'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public.current_tenant_id()::text
    AND (storage.foldername(name))[3] = 'readings'
  );

CREATE POLICY meter_readings_delete_own_tenant
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'meter-readings'
    AND (storage.foldername(name))[1] = 'tenants'
    AND (storage.foldername(name))[2] = public.current_tenant_id()::text
    AND (storage.foldername(name))[3] = 'readings'
    AND public.has_tenant_role(public.current_tenant_id(), 'manager')
  );