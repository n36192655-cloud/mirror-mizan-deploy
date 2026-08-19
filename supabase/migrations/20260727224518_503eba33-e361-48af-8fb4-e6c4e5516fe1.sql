CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.app_role AS ENUM ('super_admin','manager','reader','collector');
CREATE TYPE public.subscription_status AS ENUM ('active','suspended','expired');

CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subscription_status public.subscription_status NOT NULL DEFAULT 'active',
  subscription_expires_at TIMESTAMPTZ,
  max_devices INT NOT NULL DEFAULT 3,
  arrears_threshold NUMERIC NOT NULL DEFAULT 5000,
  auto_suspend BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  display_name TEXT,
  phone TEXT,
  username TEXT UNIQUE,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_user_id_tenant_id_role_key UNIQUE NULLS NOT DISTINCT (user_id, tenant_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $fn$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role); $fn$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE
AS $fn$ SELECT false; $fn$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID LANGUAGE SQL IMMUTABLE
AS $fn$ SELECT '00000000-0000-0000-0000-000000000001'::uuid; $fn$;

CREATE OR REPLACE FUNCTION public.has_tenant_role(_tenant_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = _role
      AND (tenant_id = _tenant_id)
  );
$fn$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.profiles (id, tenant_id, display_name, email, username)
  VALUES (
    NEW.id,
    '00000000-0000-0000-0000-000000000001'::uuid,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    NEW.email,
    NEW.raw_user_meta_data->>'username'
  )
  ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;
  RETURN NEW;
END; $fn$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public
AS $fn$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $fn$;

CREATE TRIGGER trg_tenants_updated BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE POLICY "read own tenant" ON public.tenants FOR SELECT TO authenticated
  USING (id = public.current_tenant_id());
CREATE POLICY "manager update own tenant" ON public.tenants FOR UPDATE TO authenticated
  USING (id = public.current_tenant_id() AND public.has_tenant_role(id,'manager'))
  WITH CHECK (id = public.current_tenant_id() AND public.has_tenant_role(id,'manager'));

CREATE POLICY "read own profile or same tenant" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR tenant_id = public.current_tenant_id());
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "manager insert tenant profiles" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (tenant_id IS NOT NULL AND public.has_tenant_role(tenant_id,'manager'));
CREATE POLICY "manager update tenant profiles" ON public.profiles FOR UPDATE TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_role(tenant_id,'manager'))
  WITH CHECK (tenant_id IS NOT NULL AND public.has_tenant_role(tenant_id,'manager'));

CREATE POLICY "read own roles or same tenant manager" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR (tenant_id = public.current_tenant_id() AND public.has_tenant_role(public.current_tenant_id(),'manager')));
CREATE POLICY "manager manage tenant roles" ON public.user_roles FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_role(tenant_id,'manager') AND role IN ('reader','collector','manager'))
  WITH CHECK (tenant_id IS NOT NULL AND public.has_tenant_role(tenant_id,'manager') AND role IN ('reader','collector','manager'));

CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  pay_account TEXT UNIQUE,
  meter_number TEXT,
  security_deposit NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  suspended_reason TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  balance NUMERIC NOT NULL DEFAULT 0,
  family_members INT NOT NULL DEFAULT 5,
  directorate TEXT,
  submitted_by UUID REFERENCES auth.users(id),
  submitted_at TIMESTAMPTZ,
  geo_accuracy NUMERIC,
  geo_captured_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customers_tenant_meter_idx ON public.customers(tenant_id, meter_number);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE POLICY "tenant read customers" ON public.customers FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());
CREATE POLICY "manager write customers" ON public.customers FOR ALL TO authenticated
  USING (public.has_tenant_role(tenant_id,'manager'))
  WITH CHECK (public.has_tenant_role(tenant_id,'manager'));
CREATE POLICY "reader/collector update customer geo" ON public.customers FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id() AND (public.has_tenant_role(tenant_id,'reader') OR public.has_tenant_role(tenant_id,'collector')))
  WITH CHECK (tenant_id = public.current_tenant_id() AND (public.has_tenant_role(tenant_id,'reader') OR public.has_tenant_role(tenant_id,'collector')));

CREATE OR REPLACE FUNCTION public.email_for_username(_username TEXT)
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT email FROM public.profiles WHERE lower(username) = lower(_username) LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.email_for_username(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_for_username(TEXT) TO anon, authenticated;

CREATE TABLE public.device_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  device_label TEXT,
  user_agent TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_fingerprint)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_sessions TO authenticated;
GRANT ALL ON public.device_sessions TO service_role;
ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user manage own session" ON public.device_sessions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "tenant read sessions" ON public.device_sessions FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id() AND public.has_tenant_role(tenant_id,'manager'));

CREATE OR REPLACE FUNCTION public.register_device_slot(_device_fingerprint TEXT, _device_label TEXT DEFAULT NULL, _user_agent TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _uid UUID := auth.uid(); _tid UUID; _max INT; _count INT;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT tenant_id INTO _tid FROM public.profiles WHERE id = _uid;
  IF _tid IS NULL THEN
    INSERT INTO public.device_sessions (user_id, device_fingerprint, device_label, user_agent)
    VALUES (_uid, _device_fingerprint, _device_label, _user_agent)
    ON CONFLICT (user_id, device_fingerprint) DO UPDATE SET last_seen_at = now(), device_label = EXCLUDED.device_label;
    RETURN;
  END IF;
  SELECT max_devices INTO _max FROM public.tenants WHERE id = _tid;
  INSERT INTO public.device_sessions (user_id, tenant_id, device_fingerprint, device_label, user_agent)
  VALUES (_uid, _tid, _device_fingerprint, _device_label, _user_agent)
  ON CONFLICT (user_id, device_fingerprint) DO UPDATE SET last_seen_at = now(), device_label = EXCLUDED.device_label;
  SELECT count(*) INTO _count FROM public.device_sessions WHERE user_id = _uid;
  IF _count > COALESCE(_max, 3) THEN
    DELETE FROM public.device_sessions WHERE id IN (
      SELECT id FROM public.device_sessions WHERE user_id = _uid ORDER BY last_seen_at ASC LIMIT (_count - COALESCE(_max, 3))
    );
  END IF;
END; $fn$;
GRANT EXECUTE ON FUNCTION public.register_device_slot(TEXT, TEXT, TEXT) TO authenticated;

CREATE TABLE public.water_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  meter_number TEXT NOT NULL,
  current_reading NUMERIC NOT NULL,
  previous NUMERIC,
  consumption NUMERIC,
  reading_date DATE NOT NULL DEFAULT CURRENT_DATE,
  photo_url TEXT,
  lat NUMERIC,
  lng NUMERIC,
  status TEXT NOT NULL DEFAULT 'approved',
  flag TEXT,
  client_uuid TEXT,
  accuracy NUMERIC,
  ocr_serial TEXT,
  reader_id UUID REFERENCES auth.users(id),
  gps_verified BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.water_readings TO authenticated;
GRANT ALL ON public.water_readings TO service_role;
ALTER TABLE public.water_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read readings" ON public.water_readings FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "reader manager insert readings" ON public.water_readings FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id() AND (public.has_tenant_role(tenant_id,'reader') OR public.has_tenant_role(tenant_id,'manager')));
CREATE POLICY "manager update readings" ON public.water_readings FOR UPDATE TO authenticated USING (public.has_tenant_role(tenant_id,'manager')) WITH CHECK (public.has_tenant_role(tenant_id,'manager'));
CREATE POLICY "manager delete readings" ON public.water_readings FOR DELETE TO authenticated USING (public.has_tenant_role(tenant_id,'manager'));

CREATE TABLE public.water_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  reading_id UUID REFERENCES public.water_readings(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  arrears NUMERIC NOT NULL DEFAULT 0,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.water_bills TO authenticated;
GRANT ALL ON public.water_bills TO service_role;
ALTER TABLE public.water_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read bills" ON public.water_bills FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "manager collector write bills" ON public.water_bills FOR ALL TO authenticated USING (public.has_tenant_role(tenant_id,'manager') OR public.has_tenant_role(tenant_id,'collector')) WITH CHECK (public.has_tenant_role(tenant_id,'manager') OR public.has_tenant_role(tenant_id,'collector'));

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bill_id UUID REFERENCES public.water_bills(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  client_uuid TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read payments" ON public.payments FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "collector manager write payments" ON public.payments FOR ALL TO authenticated USING (public.has_tenant_role(tenant_id,'collector') OR public.has_tenant_role(tenant_id,'manager')) WITH CHECK (public.has_tenant_role(tenant_id,'collector') OR public.has_tenant_role(tenant_id,'manager'));

CREATE TABLE public.production_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  logged_at DATE NOT NULL DEFAULT CURRENT_DATE,
  produced_m3 NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_log TO authenticated;
GRANT ALL ON public.production_log TO service_role;
ALTER TABLE public.production_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read production" ON public.production_log FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "manager write production" ON public.production_log FOR ALL TO authenticated USING (public.has_tenant_role(tenant_id,'manager')) WITH CHECK (public.has_tenant_role(tenant_id,'manager'));

CREATE TABLE public.tenancy_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  meter_number TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenancy_logs TO authenticated;
GRANT ALL ON public.tenancy_logs TO service_role;
ALTER TABLE public.tenancy_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read tenancy" ON public.tenancy_logs FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "manager write tenancy" ON public.tenancy_logs FOR ALL TO authenticated USING (public.has_tenant_role(tenant_id,'manager')) WITH CHECK (public.has_tenant_role(tenant_id,'manager'));

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read audit" ON public.audit_logs FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "tenant insert audit" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());

CREATE TABLE public.tariffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  is_active BOOLEAN NOT NULL DEFAULT true,
  fixed_fee NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'YER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tariffs TO authenticated;
GRANT ALL ON public.tariffs TO service_role;
ALTER TABLE public.tariffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read tariffs" ON public.tariffs FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "manager write tariffs" ON public.tariffs FOR ALL TO authenticated USING (public.has_tenant_role(tenant_id,'manager')) WITH CHECK (public.has_tenant_role(tenant_id,'manager'));

CREATE TABLE public.tariff_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tariff_id UUID NOT NULL REFERENCES public.tariffs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tier_order INT NOT NULL,
  upper_bound NUMERIC,
  rate_per_m3 NUMERIC NOT NULL,
  UNIQUE (tariff_id, tier_order)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tariff_tiers TO authenticated;
GRANT ALL ON public.tariff_tiers TO service_role;
ALTER TABLE public.tariff_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read tariff tiers" ON public.tariff_tiers FOR SELECT TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "manager write tariff tiers" ON public.tariff_tiers FOR ALL TO authenticated USING (public.has_tenant_role(tenant_id,'manager')) WITH CHECK (public.has_tenant_role(tenant_id,'manager'));

CREATE OR REPLACE FUNCTION public.approve_reading(_reading_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE _tid UUID;
BEGIN
  SELECT tenant_id INTO _tid FROM public.water_readings WHERE id = _reading_id;
  IF _tid IS NULL THEN RAISE EXCEPTION 'reading not found'; END IF;
  IF NOT public.has_tenant_role(_tid, 'manager') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.water_readings SET status = 'approved' WHERE id = _reading_id;
END; $fn$;
GRANT EXECUTE ON FUNCTION public.approve_reading(UUID) TO authenticated;

-- Seed the single tenant.
INSERT INTO public.tenants (id, name, subscription_status, subscription_expires_at, max_devices, auto_suspend)
VALUES ('00000000-0000-0000-0000-000000000001', 'مياه المسراخ', 'active', now() + interval '100 years', 10, false);

-- Seed the three operational users.
DO $$
DECLARE
  _mgr uuid := gen_random_uuid();
  _rdr uuid := gen_random_uuid();
  _clc uuid := gen_random_uuid();
  _tid uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', _mgr, 'authenticated', 'authenticated',
    'manager@mizan.local', crypt('Manager#2026!', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"مدير المشروع","username":"manager"}'::jsonb,
    false, '', '', '', ''
  );
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), _mgr,
    jsonb_build_object('sub', _mgr::text, 'email', 'manager@mizan.local', 'email_verified', true),
    'email', _mgr::text, now(), now(), now());
  UPDATE public.profiles SET username='manager', display_name='مدير المشروع', tenant_id=_tid, must_change_password=false WHERE id=_mgr;
  INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES (_mgr, _tid, 'manager');

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', _rdr, 'authenticated', 'authenticated',
    'reader@mizan.local', crypt('Reader#2026!', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"قارئ العدادات","username":"reader"}'::jsonb,
    false, '', '', '', ''
  );
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), _rdr,
    jsonb_build_object('sub', _rdr::text, 'email', 'reader@mizan.local', 'email_verified', true),
    'email', _rdr::text, now(), now(), now());
  UPDATE public.profiles SET username='reader', display_name='قارئ العدادات', tenant_id=_tid, must_change_password=false WHERE id=_rdr;
  INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES (_rdr, _tid, 'reader');

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', _clc, 'authenticated', 'authenticated',
    'collector@mizan.local', crypt('Collector#2026!', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"محصل الفواتير","username":"collector"}'::jsonb,
    false, '', '', '', ''
  );
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), _clc,
    jsonb_build_object('sub', _clc::text, 'email', 'collector@mizan.local', 'email_verified', true),
    'email', _clc::text, now(), now(), now());
  UPDATE public.profiles SET username='collector', display_name='محصل الفواتير', tenant_id=_tid, must_change_password=false WHERE id=_clc;
  INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES (_clc, _tid, 'collector');
END $$;

INSERT INTO public.tariffs (id, tenant_id, name, is_active, fixed_fee, currency)
VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'التعرفة الافتراضية', true, 0, 'YER');

INSERT INTO public.tariff_tiers (tariff_id, tenant_id, tier_order, upper_bound, rate_per_m3) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 1, 5, 100),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 2, 12, 250),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 3, NULL, 500);
