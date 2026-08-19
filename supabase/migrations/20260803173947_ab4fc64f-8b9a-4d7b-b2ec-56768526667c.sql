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