GRANT USAGE ON SCHEMA auth TO sandbox_exec;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON auth.users TO sandbox_exec;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON auth.identities TO sandbox_exec;
GRANT USAGE ON SCHEMA extensions TO sandbox_exec;