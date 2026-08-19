CREATE OR REPLACE FUNCTION public.__import_exec(sql TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$ BEGIN EXECUTE sql; END; $fn$;
REVOKE ALL ON FUNCTION public.__import_exec(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.__import_exec(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.__import_exec(TEXT) TO service_role;