DROP FUNCTION IF EXISTS public.__setup_exec(text);
REVOKE ALL ON SCHEMA public FROM sandbox_exec;
GRANT USAGE ON SCHEMA public TO sandbox_exec;