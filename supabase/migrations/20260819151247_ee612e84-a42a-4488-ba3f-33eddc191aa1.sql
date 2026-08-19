CREATE OR REPLACE FUNCTION public.__import_exec(p_sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout TO '600000'
AS $fn$
BEGIN
  EXECUTE p_sql;
END;
$fn$;
REVOKE ALL ON FUNCTION public.__import_exec(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.__import_exec(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.__import_exec(text) TO service_role;