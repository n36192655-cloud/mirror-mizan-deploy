-- ============================================================================
-- MIZAN AI - Enterprise Utility Billing Engine
-- Migration #04: Financial Architecture & Security Hardening
--
-- Description:
--   Customer balance materialized state.
--   Lock hierarchy.
--   Optimized financial operations.
--   Hardened RLS.
--
-- Compatibility:
--   PostgreSQL 15+
--   Supabase Managed RLS
-- ============================================================================


BEGIN;



-- ============================================================================
-- 1. Standardize Financial Precision
-- ============================================================================


ALTER TABLE public.water_bills

ALTER COLUMN amount TYPE NUMERIC(18,3),

ALTER COLUMN total TYPE NUMERIC(18,3),

ALTER COLUMN subtotal TYPE NUMERIC(18,3),

ALTER COLUMN arrears_snapshot TYPE NUMERIC(18,3),

ALTER COLUMN net_amount TYPE NUMERIC(18,3);



ALTER TABLE public.payments

ALTER COLUMN amount TYPE NUMERIC(18,3);



ALTER TABLE public.billing_adjustments

ALTER COLUMN amount TYPE NUMERIC(18,3);



ALTER TABLE public.customer_ledger

ALTER COLUMN debit_amount TYPE NUMERIC(18,3),

ALTER COLUMN credit_amount TYPE NUMERIC(18,3),

ALTER COLUMN running_balance TYPE NUMERIC(18,3);




-- ============================================================================
-- 2. Customer Balance State Table
-- ============================================================================


CREATE TABLE IF NOT EXISTS public.customer_balances
(

customer_id UUID PRIMARY KEY

REFERENCES public.customers(id)

ON DELETE RESTRICT,


tenant_id UUID NOT NULL

REFERENCES public.tenants(id)

ON DELETE RESTRICT,


current_balance NUMERIC(18,3)

NOT NULL DEFAULT 0.000,


total_debits NUMERIC(18,3)

NOT NULL DEFAULT 0.000,


total_credits NUMERIC(18,3)

NOT NULL DEFAULT 0.000,


last_ledger_id UUID

REFERENCES public.customer_ledger(id)

ON DELETE SET NULL,


updated_at TIMESTAMPTZ

NOT NULL DEFAULT now(),



CONSTRAINT uq_customer_balance_tenant

UNIQUE
(
tenant_id,
customer_id
)

);



CREATE INDEX IF NOT EXISTS idx_customer_balance_lookup

ON public.customer_balances
(
tenant_id,
customer_id
);




ALTER TABLE public.customer_balances

ENABLE ROW LEVEL SECURITY;



DROP POLICY IF EXISTS tenant_select_customer_balances

ON public.customer_balances;



CREATE POLICY tenant_select_customer_balances

ON public.customer_balances

FOR SELECT

TO authenticated

USING

(
tenant_id = public.current_tenant_id()
);





-- ============================================================================
-- 3. Initial Balance Synchronization
-- ============================================================================


INSERT INTO public.customer_balances
(
customer_id,
tenant_id,
current_balance
)

SELECT

id,

tenant_id,

COALESCE(balance,0)

FROM public.customers


ON CONFLICT(customer_id)

DO NOTHING;





-- ============================================================================
-- 4. Enterprise Lock Hierarchy
-- ============================================================================


CREATE OR REPLACE FUNCTION public.acquire_customer_lock

(
_tenant_id UUID,

_customer_id UUID

)

RETURNS VOID


LANGUAGE plpgsql


SECURITY DEFINER


SET search_path = pg_catalog,public,pg_temp


AS $$


DECLARE

_dummy UUID;


BEGIN


PERFORM public.assert_authenticated_context();



IF _tenant_id IS NULL

OR _customer_id IS NULL

THEN

RAISE EXCEPTION

'Tenant and customer required';

END IF;




-- Tenant root lock

PERFORM 1

FROM public.tenants

WHERE id=_tenant_id

FOR SHARE;




-- Financial root lock

SELECT customer_id

INTO _dummy


FROM public.customer_balances


WHERE tenant_id=_tenant_id

AND customer_id=_customer_id


FOR UPDATE;



IF _dummy IS NULL THEN


SELECT id

INTO _dummy

FROM public.customers

WHERE tenant_id=_tenant_id

AND id=_customer_id

FOR UPDATE;



IF _dummy IS NULL THEN

RAISE EXCEPTION

'Customer not found';

END IF;


END IF;



END;

$$;




REVOKE ALL ON FUNCTION public.acquire_customer_lock(UUID,UUID)

FROM PUBLIC;


GRANT EXECUTE ON FUNCTION public.acquire_customer_lock(UUID,UUID)

TO authenticated,service_role;






-- ============================================================================
-- 5. Optimized Balance Recalculation
-- ============================================================================


CREATE OR REPLACE FUNCTION public.recalc_customer_balance

(
_customer_id UUID

)

RETURNS NUMERIC


LANGUAGE plpgsql


SECURITY DEFINER


SET search_path = pg_catalog,public,pg_temp



AS $$



DECLARE


_balance NUMERIC(18,3);

_debit NUMERIC(18,3);

_credit NUMERIC(18,3);

_tenant UUID;

_last UUID;



BEGIN



SELECT tenant_id

INTO _tenant

FROM public.customers

WHERE id=_customer_id;



IF _tenant IS NULL THEN

RETURN 0;

END IF;




PERFORM public.acquire_customer_lock

(
_tenant,
_customer_id
);




SELECT

COALESCE(SUM(debit_amount),0),

COALESCE(SUM(credit_amount),0)

INTO

_debit,

_credit


FROM public.customer_ledger


WHERE tenant_id=_tenant

AND customer_id=_customer_id;



_balance := _debit-_credit;




SELECT id

INTO _last

FROM public.customer_ledger


WHERE tenant_id=_tenant

AND customer_id=_customer_id


ORDER BY posted_at DESC,id DESC

LIMIT 1;





INSERT INTO public.customer_balances

(
customer_id,
tenant_id,
current_balance,
total_debits,
total_credits,
last_ledger_id,
updated_at
)

VALUES

(
_customer_id,
_tenant,
_balance,
_debit,
_credit,
_last,
now()
)


ON CONFLICT(customer_id)

DO UPDATE SET

current_balance=EXCLUDED.current_balance,

total_debits=EXCLUDED.total_debits,

total_credits=EXCLUDED.total_credits,

last_ledger_id=EXCLUDED.last_ledger_id,

updated_at=now();




UPDATE public.customers

SET balance=_balance

WHERE id=_customer_id;



RETURN _balance;



END;

$$;





REVOKE ALL ON FUNCTION public.recalc_customer_balance(UUID)

FROM PUBLIC;


GRANT EXECUTE ON FUNCTION public.recalc_customer_balance(UUID)

TO authenticated,service_role;






-- ============================================================================
-- 6. Ledger Covering Indexes
-- ============================================================================


CREATE INDEX IF NOT EXISTS idx_customer_ledger_covering

ON public.customer_ledger

(
tenant_id,
customer_id,
posted_at DESC,
id DESC
)

INCLUDE
(
running_balance,
debit_amount,
credit_amount
);





CREATE INDEX IF NOT EXISTS idx_readings_meter_date

ON public.water_readings

(
meter_id,
reading_date DESC,
status
);





-- ============================================================================
-- 7. Harden Customer Ledger RLS
-- ============================================================================


DROP POLICY IF EXISTS tenant_select_customer_ledger

ON public.customer_ledger;



CREATE POLICY tenant_select_customer_ledger

ON public.customer_ledger

FOR SELECT

TO authenticated

USING
(

tenant_id = public.current_tenant_id()

AND

(

public.has_tenant_role
(
tenant_id,
'super_admin'
)

OR

public.has_tenant_role
(
tenant_id,
'manager'
)

OR

public.has_tenant_role
(
tenant_id,
'collector'
)

OR

customer_id = auth.uid()

)

);




COMMIT;
