DROP FUNCTION IF EXISTS public.__import_exec(TEXT);
DROP FUNCTION IF EXISTS public.__import_exec2(TEXT);
DROP FUNCTION IF EXISTS public.__setup_exec(TEXT);

CREATE OR REPLACE FUNCTION public.storage_path_in_tenant(storage_path TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE path_tenant UUID; user_tenant UUID;
BEGIN
  BEGIN
    path_tenant := (string_to_array(storage_path, '/'))[1]::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;
  SELECT tenant_id INTO user_tenant FROM public.profiles WHERE id = auth.uid();
  RETURN user_tenant IS NOT NULL AND path_tenant = user_tenant;
END; $fn$;
REVOKE ALL ON FUNCTION public.storage_path_in_tenant(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_path_in_tenant(TEXT) TO authenticated;

DROP POLICY IF EXISTS "Meter readings storage upload policy" ON storage.objects;
DROP POLICY IF EXISTS "Meter readings storage read policy" ON storage.objects;
DROP POLICY IF EXISTS "Meter readings storage update policy" ON storage.objects;
DROP POLICY IF EXISTS "Meter readings storage delete policy" ON storage.objects;

CREATE POLICY "Meter readings storage upload policy" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'meter-readings' AND public.storage_path_in_tenant(name));
CREATE POLICY "Meter readings storage read policy" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'meter-readings' AND public.storage_path_in_tenant(name));
CREATE POLICY "Meter readings storage update policy" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'meter-readings' AND public.storage_path_in_tenant(name));
CREATE POLICY "Meter readings storage delete policy" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'meter-readings' AND public.storage_path_in_tenant(name));