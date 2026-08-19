CREATE OR REPLACE FUNCTION public.__setup_exec(_sql text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, auth AS $$
BEGIN EXECUTE _sql; END $$;
REVOKE ALL ON FUNCTION public.__setup_exec(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.__setup_exec(text) TO sandbox_exec;