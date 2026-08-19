DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres;

CREATE OR REPLACE FUNCTION public.__lov_apply(sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  EXECUTE sql;
END;
$$;

REVOKE ALL ON FUNCTION public.__lov_apply(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.__lov_apply(text) TO service_role;