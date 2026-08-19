-- Safety backups (dropped in M4 after sign-off)
CREATE TABLE public._meter_migration_backup_customers AS
  SELECT id, tenant_id, meter_number FROM public.customers;
CREATE TABLE public._meter_migration_backup_readings AS
  SELECT id, tenant_id, meter_number, customer_id, previous, consumption FROM public.water_readings;
REVOKE ALL ON public._meter_migration_backup_customers FROM anon, authenticated;
REVOKE ALL ON public._meter_migration_backup_readings FROM anon, authenticated;
ALTER TABLE public._meter_migration_backup_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._meter_migration_backup_readings ENABLE ROW LEVEL SECURITY;

-- Enforce the new identity
ALTER TABLE public.water_readings ALTER COLUMN meter_id SET NOT NULL;
CREATE UNIQUE INDEX water_readings_one_per_meter_day
  ON public.water_readings (meter_id, reading_date) WHERE status <> 'rejected';

-- Reading pipeline now keyed on meter_id
CREATE OR REPLACE FUNCTION public.tg_reading_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _prev NUMERIC; _avg NUMERIC; _init NUMERIC; _started TIMESTAMPTZ; _cust UUID; _tid UUID;
BEGIN
  IF NEW.meter_id IS NULL THEN RAISE EXCEPTION 'meter_id is required'; END IF;

  SELECT tenant_id, initial_index INTO _tid, _init FROM public.meters WHERE id = NEW.meter_id;
  IF _tid IS NULL THEN RAISE EXCEPTION 'meter not found'; END IF;
  NEW.tenant_id := _tid;

  -- customer is derived from the assignment covering the reading date
  SELECT customer_id, started_at INTO _cust, _started
    FROM public.meter_assignments
   WHERE meter_id = NEW.meter_id
     AND started_at <= (NEW.reading_date + 1)::timestamptz
     AND (ended_at IS NULL OR ended_at >= NEW.reading_date::timestamptz)
   ORDER BY started_at DESC LIMIT 1;
  NEW.customer_id := _cust;

  -- previous index: last non-rejected reading of THIS meter within the current assignment window
  IF NEW.previous IS NULL THEN
    SELECT current_reading INTO _prev FROM public.water_readings
     WHERE meter_id = NEW.meter_id
       AND status <> 'rejected'
       AND (_started IS NULL OR created_at >= _started)
     ORDER BY reading_date DESC, created_at DESC LIMIT 1;
    NEW.previous := COALESCE(_prev, _init, 0);
  END IF;

  NEW.consumption := GREATEST(NEW.current_reading - COALESCE(NEW.previous, 0), 0);

  SELECT AVG(consumption) INTO _avg FROM public.water_readings
   WHERE meter_id = NEW.meter_id AND status = 'approved';

  IF NEW.current_reading < COALESCE(NEW.previous, 0) THEN
    NEW.flag := 'error'; NEW.status := 'pending_approval';
  ELSIF _avg IS NOT NULL AND _avg > 0 AND NEW.consumption > _avg * 3 THEN
    NEW.flag := 'suspicious'; NEW.status := 'pending_approval';
  ELSE
    NEW.flag := COALESCE(NEW.flag, 'ok'); NEW.status := 'approved';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS tg_reading_before_insert ON public.water_readings;
CREATE TRIGGER tg_reading_before_insert BEFORE INSERT ON public.water_readings
  FOR EACH ROW EXECUTE FUNCTION public.tg_reading_before_insert();

DROP TRIGGER IF EXISTS tg_reading_after_write ON public.water_readings;
CREATE TRIGGER tg_reading_after_write AFTER INSERT OR UPDATE ON public.water_readings
  FOR EACH ROW EXECUTE FUNCTION public.tg_reading_after_write();

-- Legacy text identity removed
DROP INDEX IF EXISTS water_readings_meter_number_idx;
ALTER TABLE public.water_readings DROP COLUMN meter_number;
ALTER TABLE public.customers DROP COLUMN meter_number;

REVOKE ALL ON FUNCTION public.assign_meter(UUID, TEXT, TEXT, NUMERIC, DATE) FROM anon, public;
REVOKE ALL ON FUNCTION public.unassign_meter(UUID, TEXT) FROM anon, public;
REVOKE ALL ON FUNCTION public.replace_meter(UUID, TEXT, NUMERIC, TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.assign_meter(UUID, TEXT, TEXT, NUMERIC, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unassign_meter(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_meter(UUID, TEXT, NUMERIC, TEXT, TEXT) TO authenticated;