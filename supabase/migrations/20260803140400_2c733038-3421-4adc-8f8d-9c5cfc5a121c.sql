CREATE OR REPLACE FUNCTION public.__import_exec(sql TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$ BEGIN EXECUTE sql; END; $fn$;