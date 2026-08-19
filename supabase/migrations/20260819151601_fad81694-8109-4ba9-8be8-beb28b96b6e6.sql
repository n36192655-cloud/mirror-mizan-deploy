CREATE OR REPLACE FUNCTION public.__lov_exec(sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
SET statement_timeout TO 600000
AS $q$ BEGIN EXECUTE sql; END; $q$;
REVOKE ALL ON FUNCTION public.__lov_exec(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.__lov_exec(text) TO service_role;