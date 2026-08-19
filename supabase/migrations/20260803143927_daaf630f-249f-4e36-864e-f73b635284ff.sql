INSERT INTO public.meters (tenant_id, serial, meter_type, initial_index, status)
SELECT DISTINCT c.tenant_id, upper(btrim(c.meter_number)), 'water', 0, 'active'
FROM public.customers c
WHERE c.meter_number IS NOT NULL AND btrim(c.meter_number) <> ''
ON CONFLICT DO NOTHING;

INSERT INTO public.meter_assignments (tenant_id, meter_id, customer_id, started_at)
SELECT c.tenant_id, m.id, c.id, COALESCE(c.created_at, now())
FROM public.customers c
JOIN public.meters m ON m.tenant_id = c.tenant_id AND upper(btrim(m.serial)) = upper(btrim(c.meter_number))
WHERE c.meter_number IS NOT NULL AND btrim(c.meter_number) <> ''
ON CONFLICT DO NOTHING;

ALTER TABLE public.water_readings DISABLE TRIGGER USER;
UPDATE public.water_readings r
SET meter_id = m.id
FROM public.meters m
WHERE r.meter_id IS NULL
  AND m.tenant_id = r.tenant_id
  AND upper(btrim(m.serial)) = upper(btrim(r.meter_number));
DELETE FROM public.water_bills b USING public.water_readings r WHERE b.reading_id = r.id AND r.meter_id IS NULL;
DELETE FROM public.water_readings WHERE meter_id IS NULL;
ALTER TABLE public.water_readings ENABLE TRIGGER USER;