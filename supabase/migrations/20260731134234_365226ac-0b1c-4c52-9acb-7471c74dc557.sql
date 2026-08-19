DROP FUNCTION IF EXISTS public.assign_meter(uuid, text, text, numeric, date);
DROP FUNCTION IF EXISTS public.replace_meter(uuid, text, numeric, text, text);

CREATE OR REPLACE FUNCTION public.assign_meter(
  _customer_id uuid,
  _serial text,
  _meter_type text DEFAULT 'water',
  _initial_index numeric DEFAULT 0,
  _installed_at date DEFAULT NULL,
  _started_at timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _tid UUID; _serial_n TEXT; _meter_id UUID; _open UUID; _start TIMESTAMPTZ; _last_end TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  _serial_n := upper(btrim(COALESCE(_serial, '')));
  IF _serial_n = '' THEN RAISE EXCEPTION 'serial is required'; END IF;

  SELECT tenant_id INTO _tid FROM public.customers WHERE id = _customer_id;
  IF _tid IS NULL THEN RAISE EXCEPTION 'customer not found'; END IF;
  IF NOT public.has_tenant_role(_tid, 'manager') THEN RAISE EXCEPTION 'forbidden'; END IF;

  _start := COALESCE(_started_at, now());
  IF _start > now() THEN RAISE EXCEPTION 'assignment cannot start in the future'; END IF;

  SELECT id INTO _meter_id FROM public.meters
   WHERE tenant_id = _tid AND upper(btrim(serial)) = _serial_n;

  IF _meter_id IS NULL THEN
    INSERT INTO public.meters (tenant_id, serial, meter_type, initial_index, installed_at, created_by)
    VALUES (_tid, _serial_n, COALESCE(_meter_type,'water'), COALESCE(_initial_index,0),
            COALESCE(_installed_at, _start::date), auth.uid())
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

  -- no overlap with this meter's own closed history
  SELECT MAX(ended_at) INTO _last_end FROM public.meter_assignments WHERE meter_id = _meter_id;
  IF _last_end IS NOT NULL AND _start < _last_end THEN
    RAISE EXCEPTION 'assignment start overlaps a previous assignment of meter %', _serial_n;
  END IF;

  UPDATE public.meter_assignments
     SET ended_at = LEAST(now(), _start), end_reason = 'reassigned'
   WHERE customer_id = _customer_id AND ended_at IS NULL;

  INSERT INTO public.meter_assignments (tenant_id, meter_id, customer_id, started_at, created_by)
  VALUES (_tid, _meter_id, _customer_id, _start, auth.uid());

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, details)
  VALUES (_tid, auth.uid(), 'meter.assign', 'meters', _meter_id,
          jsonb_build_object('serial', _serial_n, 'customer_id', _customer_id, 'started_at', _start));

  RETURN _meter_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.replace_meter(
  _customer_id uuid,
  _new_serial text,
  _new_initial_index numeric DEFAULT 0,
  _old_meter_status text DEFAULT 'removed',
  _reason text DEFAULT 'replaced',
  _started_at timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _tid UUID; _old_meter UUID; _start TIMESTAMPTZ; _new UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT tenant_id INTO _tid FROM public.customers WHERE id = _customer_id;
  IF _tid IS NULL THEN RAISE EXCEPTION 'customer not found'; END IF;
  IF NOT public.has_tenant_role(_tid, 'manager') THEN RAISE EXCEPTION 'forbidden'; END IF;

  _start := COALESCE(_started_at, now());
  IF _start > now() THEN RAISE EXCEPTION 'replacement cannot start in the future'; END IF;

  SELECT meter_id INTO _old_meter FROM public.meter_assignments
   WHERE customer_id = _customer_id AND ended_at IS NULL;

  UPDATE public.meter_assignments
     SET ended_at = _start, end_reason = COALESCE(_reason, 'replaced')
   WHERE customer_id = _customer_id AND ended_at IS NULL;

  IF _old_meter IS NOT NULL THEN
    UPDATE public.meters SET status = COALESCE(_old_meter_status, 'removed') WHERE id = _old_meter;
  END IF;

  _new := public.assign_meter(_customer_id, _new_serial, 'water', COALESCE(_new_initial_index, 0), _start::date, _start);

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, details)
  VALUES (_tid, auth.uid(), 'meter.replace', 'meters', _new,
          jsonb_build_object('old_meter_id', _old_meter, 'customer_id', _customer_id, 'started_at', _start));

  RETURN _new;
END; $function$;