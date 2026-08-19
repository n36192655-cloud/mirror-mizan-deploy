CREATE OR REPLACE FUNCTION public.user_belongs_to_org_path(storage_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  path_org_id uuid;
  user_org_id uuid;
BEGIN
  BEGIN
    path_org_id := (string_to_array(storage_path, '/'))[1]::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  SELECT tenant_id INTO user_org_id FROM public.profiles WHERE id = auth.uid();
  IF user_org_id IS NULL THEN RETURN false; END IF;
  RETURN path_org_id = user_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.user_belongs_to_org_path(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_belongs_to_org_path(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_belongs_to_org_path(text) TO authenticated;

DROP POLICY IF EXISTS "Meter readings storage upload policy" ON storage.objects;
DROP POLICY IF EXISTS "Meter readings storage read policy" ON storage.objects;
DROP POLICY IF EXISTS "Meter readings storage update policy" ON storage.objects;
DROP POLICY IF EXISTS "Meter readings storage delete policy" ON storage.objects;

CREATE POLICY "Meter readings storage upload policy" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'meter-readings' AND public.user_belongs_to_org_path(name));
CREATE POLICY "Meter readings storage read policy" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'meter-readings' AND public.user_belongs_to_org_path(name));
CREATE POLICY "Meter readings storage update policy" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'meter-readings' AND public.user_belongs_to_org_path(name));
CREATE POLICY "Meter readings storage delete policy" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'meter-readings' AND public.user_belongs_to_org_path(name));