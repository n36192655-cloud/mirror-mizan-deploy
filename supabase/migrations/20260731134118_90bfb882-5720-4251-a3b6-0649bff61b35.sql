-- A reading must always resolve to the customer served by that meter on that
-- date. Previously an out-of-window date silently produced customer_id = NULL,
-- which meant the reading was stored, approved, and never billed.
CREATE OR REPLACE FUNCTION public.tg_reading_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _prev NUMERIC; _avg NUMERIC; _init NUMERIC; _started TIMESTAMPTZ; _cust UUID; _tid UUID;
  _latest_date DATE;
BEGIN
  IF NEW.meter_id IS NULL THEN RAISE EXCEPTION 'meter_id is required'; END IF;
  IF NEW.reading_date > CURRENT_DATE THEN RAISE EXCEPTION 'reading_date cannot be in the future'; END IF;

  SELECT tenant_id, initial_index INTO _tid, _init FROM public.meters WHERE id = NEW.meter_id;
  IF _tid IS NULL THEN RAISE EXCEPTION 'meter not found'; END IF;
  NEW.tenant_id := _tid;

  -- customer is derived from the assignment covering the reading date
  SELECT customer_id, started_at INTO _cust, _started
    FROM public.meter_assignments
   WHERE meter_id = NEW.meter_id
     AND started_at::date <= NEW.reading_date
     AND (ended_at IS NULL OR ended_at::date >= NEW.reading_date)
   ORDER BY started_at DESC LIMIT 1;

  IF _cust IS NULL THEN
    RAISE EXCEPTION 'no meter assignment covers % for this meter', NEW.reading_date;
  END IF;
  NEW.customer_id := _cust;

  -- previous index: latest non-rejected reading of THIS meter, on or before the
  -- reading date, within the current assignment window
  IF NEW.previous IS NULL THEN
    SELECT current_reading INTO _prev FROM public.water_readings
     WHERE meter_id = NEW.meter_id
       AND status <> 'rejected'
       AND reading_date <= NEW.reading_date
       AND (_started IS NULL OR reading_date >= _started::date)
     ORDER BY reading_date DESC, created_at DESC LIMIT 1;
    NEW.previous := COALESCE(_prev, _init, 0);
  END IF;

  NEW.consumption := GREATEST(NEW.current_reading - COALESCE(NEW.previous, 0), 0);

  SELECT AVG(consumption) INTO _avg FROM public.water_readings
   WHERE meter_id = NEW.meter_id AND status = 'approved';

  SELECT MAX(reading_date) INTO _latest_date FROM public.water_readings
   WHERE meter_id = NEW.meter_id AND status <> 'rejected';

  IF NEW.current_reading < COALESCE(NEW.previous, 0) THEN
    NEW.flag := 'error'; NEW.status := 'pending_approval';
  ELSIF _latest_date IS NOT NULL AND NEW.reading_date < _latest_date THEN
    NEW.flag := 'backdated'; NEW.status := 'pending_approval';
  ELSIF _avg IS NOT NULL AND _avg > 0 AND NEW.consumption > _avg * 3 THEN
    NEW.flag := 'suspicious'; NEW.status := 'pending_approval';
  ELSE
    NEW.flag := COALESCE(NEW.flag, 'ok'); NEW.status := 'approved';
  END IF;
  RETURN NEW;
END; $function$;

-- Belt and braces: the column itself can never be null again (verified: 0 nulls).
ALTER TABLE public.water_readings
  ALTER COLUMN customer_id SET NOT NULL;