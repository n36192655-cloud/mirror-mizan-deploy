CREATE POLICY "meter_readings_read_own_tenant"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'meter-readings'
  AND (storage.foldername(name))[1] = 'tenants'
  AND (storage.foldername(name))[2] = (SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid())
);

CREATE POLICY "meter_readings_insert_own_tenant"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'meter-readings'
  AND (storage.foldername(name))[1] = 'tenants'
  AND (storage.foldername(name))[2] = (SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid())
);

CREATE POLICY "meter_readings_update_own_tenant"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'meter-readings'
  AND (storage.foldername(name))[2] = (SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid())
);

CREATE POLICY "meter_readings_delete_own_tenant"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'meter-readings'
  AND (storage.foldername(name))[2] = (SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid())
);

DROP FUNCTION IF EXISTS public.__lov_apply(text);