CREATE TABLE public.meters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  serial TEXT NOT NULL,
  meter_type TEXT NOT NULL DEFAULT 'water',
  size TEXT,
  installed_at DATE,
  initial_index NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX meters_tenant_serial_key ON public.meters (tenant_id, upper(btrim(serial)));
CREATE INDEX meters_tenant_idx ON public.meters (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meters TO authenticated;
GRANT ALL ON public.meters TO service_role;
ALTER TABLE public.meters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read meters" ON public.meters
  FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "manager write meters" ON public.meters
  FOR ALL TO authenticated
  USING (has_tenant_role(tenant_id, 'manager'::app_role))
  WITH CHECK (has_tenant_role(tenant_id, 'manager'::app_role));

CREATE TRIGGER meters_touch BEFORE UPDATE ON public.meters
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE TABLE public.meter_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  meter_id UUID NOT NULL REFERENCES public.meters(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX meter_assignments_one_open_per_meter
  ON public.meter_assignments (meter_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX meter_assignments_one_open_per_customer
  ON public.meter_assignments (customer_id) WHERE ended_at IS NULL;
CREATE INDEX meter_assignments_customer_idx ON public.meter_assignments (customer_id, started_at DESC);
CREATE INDEX meter_assignments_meter_idx ON public.meter_assignments (meter_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meter_assignments TO authenticated;
GRANT ALL ON public.meter_assignments TO service_role;
ALTER TABLE public.meter_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read meter assignments" ON public.meter_assignments
  FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "manager write meter assignments" ON public.meter_assignments
  FOR ALL TO authenticated
  USING (has_tenant_role(tenant_id, 'manager'::app_role))
  WITH CHECK (has_tenant_role(tenant_id, 'manager'::app_role));

CREATE TRIGGER meter_assignments_touch BEFORE UPDATE ON public.meter_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

ALTER TABLE public.water_readings ADD COLUMN meter_id UUID REFERENCES public.meters(id) ON DELETE RESTRICT;
CREATE INDEX water_readings_meter_idx ON public.water_readings (meter_id, reading_date DESC, created_at DESC);

-- Ensure or create a meter by serial, then assign it to a customer (closing any open assignment).
CREATE OR REPLACE FUNCTION public.assign_meter(
  _customer_id UUID,
  _serial TEXT,
  _meter_type TEXT DEFAULT 'water',
  _initial_index NUMERIC DEFAULT 0,
  _installed_at DATE DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
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

  RETURN _meter_id;
END; $$;

CREATE OR REPLACE FUNCTION public.unassign_meter(_customer_id UUID, _reason TEXT DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _tid UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT tenant_id INTO _tid FROM public.customers WHERE id = _customer_id;
  IF _tid IS NULL THEN RAISE EXCEPTION 'customer not found'; END IF;
  IF NOT public.has_tenant_role(_tid, 'manager') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.meter_assignments
     SET ended_at = now(), end_reason = COALESCE(_reason, 'unassigned')
   WHERE customer_id = _customer_id AND ended_at IS NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.replace_meter(
  _customer_id UUID,
  _new_serial TEXT,
  _new_initial_index NUMERIC DEFAULT 0,
  _old_meter_status TEXT DEFAULT 'removed',
  _reason TEXT DEFAULT 'replaced'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _tid UUID; _old_meter UUID;
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

  RETURN public.assign_meter(_customer_id, _new_serial, 'water', COALESCE(_new_initial_index, 0), CURRENT_DATE);
END; $$;