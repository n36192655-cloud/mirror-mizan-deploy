CREATE TABLE IF NOT EXISTS public._meter_migration_backup_customers AS
  SELECT id, tenant_id, meter_number FROM public.customers;
CREATE TABLE IF NOT EXISTS public._meter_migration_backup_readings AS
  SELECT id, tenant_id, meter_number, customer_id, previous, consumption FROM public.water_readings;
REVOKE ALL ON public._meter_migration_backup_customers FROM anon, authenticated;
REVOKE ALL ON public._meter_migration_backup_readings FROM anon, authenticated;
ALTER TABLE public._meter_migration_backup_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._meter_migration_backup_readings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.water_readings ALTER COLUMN meter_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS water_readings_one_per_meter_day
  ON public.water_readings (meter_id, reading_date) WHERE status <> 'rejected';

DROP INDEX IF EXISTS water_readings_meter_number_idx;
ALTER TABLE public.water_readings DROP COLUMN IF EXISTS meter_number;
ALTER TABLE public.customers DROP COLUMN IF EXISTS meter_number;