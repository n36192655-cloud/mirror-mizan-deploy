CREATE OR REPLACE FUNCTION public.__import_exec(sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $fn$
BEGIN
  EXECUTE sql;
END;
$fn$;

REVOKE ALL ON FUNCTION public.__import_exec(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.__import_exec(text) FROM anon;
REVOKE ALL ON FUNCTION public.__import_exec(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.__import_exec(text) TO service_role;