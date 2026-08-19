DROP FUNCTION IF EXISTS public.assign_meter(uuid, text, text, numeric, timestamp with time zone);

DROP FUNCTION IF EXISTS public.process_payment_entry(uuid, numeric, text, text);
DROP FUNCTION IF EXISTS public.approve_payment_transaction(uuid);
DROP FUNCTION IF EXISTS public.reject_payment_transaction(uuid);

ALTER TABLE public.water_bills
  DROP CONSTRAINT IF EXISTS water_bills_status_check;
ALTER TABLE public.water_bills
  ADD CONSTRAINT water_bills_status_check
  CHECK (status IN ('paid', 'partial', 'unpaid'));

ALTER TABLE public.meters
  DROP CONSTRAINT IF EXISTS meters_tenant_id_fkey;
ALTER TABLE public.meters
  ADD CONSTRAINT meters_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.meter_assignments
  DROP CONSTRAINT IF EXISTS meter_assignments_tenant_id_fkey;
ALTER TABLE public.meter_assignments
  ADD CONSTRAINT meter_assignments_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;