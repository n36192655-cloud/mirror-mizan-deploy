CREATE OR REPLACE FUNCTION public.storage_path_in_tenant(storage_path TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  parts TEXT[];
  user_tenant UUID;
  seg TEXT;
BEGIN
  SELECT tenant_id INTO user_tenant FROM public.profiles WHERE id = auth.uid();
  IF user_tenant IS NULL THEN
    RETURN false;
  END IF;

  parts := string_to_array(COALESCE(storage_path, ''), '/');
  FOREACH seg IN ARRAY parts LOOP
    BEGIN
      IF seg::uuid = user_tenant THEN
        RETURN true;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  RETURN false;
END; $fn$;