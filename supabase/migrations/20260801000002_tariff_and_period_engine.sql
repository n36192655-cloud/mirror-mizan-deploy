-- ============================================================================
-- MIZAN AI - Enterprise Utility Billing Engine
-- Migration #02: Tariff, Period & Core Financial RPC Engine
--
-- Description:
--   Secure RPC functions.
--   Historical tariff pricing.
--   Accounting period protection.
--   Hardened SECURITY DEFINER execution.
--
-- Compatibility:
--   PostgreSQL 15+
--   Supabase Managed RLS
-- ============================================================================

BEGIN;


-- ============================================================================
-- 1. Accounting Period Protection
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_period_closed
(
    _tenant_id UUID,
    _date DATE
)

RETURNS BOOLEAN

LANGUAGE plpgsql

SECURITY DEFINER

SET search_path = pg_catalog, public, pg_temp

AS $$

DECLARE

    _closed BOOLEAN;

BEGIN


    SELECT is_closed

    INTO _closed

    FROM public.accounting_periods

    WHERE tenant_id = _tenant_id

    AND _date BETWEEN start_date AND end_date

    ORDER BY start_date DESC

    LIMIT 1;



    IF _closed IS NOT NULL THEN

        RETURN _closed;

    END IF;



    /*
      Any date before the first registered
      accounting period is considered closed.
    */


    IF EXISTS
    (
        SELECT 1

        FROM public.accounting_periods

        WHERE tenant_id = _tenant_id
    )

    THEN

        IF _date <
        (
            SELECT MIN(start_date)

            FROM public.accounting_periods

            WHERE tenant_id = _tenant_id
        )

        THEN

            RETURN TRUE;

        END IF;

    END IF;



    RETURN FALSE;


END;

$$;



REVOKE ALL ON FUNCTION public.is_period_closed(UUID,DATE)
FROM PUBLIC;


GRANT EXECUTE ON FUNCTION public.is_period_closed(UUID,DATE)
TO authenticated, service_role;



-- ============================================================================
-- 2. Historical Tariff Pricing Engine
-- ============================================================================


CREATE OR REPLACE FUNCTION public.price_consumption_historical
(
    _tenant_id UUID,

    _consumption NUMERIC,

    _reading_date DATE
)


RETURNS NUMERIC


LANGUAGE plpgsql


SECURITY DEFINER


SET search_path = pg_catalog, public, pg_temp


AS $$


DECLARE

    _rate NUMERIC(18,3);


BEGIN



    IF _consumption IS NULL
       OR _consumption <= 0

    THEN

        RETURN 0.000;

    END IF;



    /*
       Prefer historical tariff version
    */


    SELECT
        (rate_structure->0->>'rate')::NUMERIC

    INTO _rate


    FROM public.tariff_versions


    WHERE tenant_id = _tenant_id


    AND _reading_date >= effective_from


    AND
    (
        effective_to IS NULL

        OR

        _reading_date <= effective_to
    )


    ORDER BY effective_from DESC


    LIMIT 1;




    /*
       Fallback active tariff
    */


    IF _rate IS NULL THEN


        SELECT price

        INTO _rate


        FROM public.tariffs


        WHERE tenant_id = _tenant_id

        AND is_active = TRUE


        LIMIT 1;


    END IF;




    RETURN ROUND
    (
        COALESCE(_rate,0)
        *
        _consumption,

        3
    );



END;

$$;



REVOKE ALL ON FUNCTION public.price_consumption_historical(UUID,NUMERIC,DATE)
FROM PUBLIC;


GRANT EXECUTE ON FUNCTION public.price_consumption_historical(UUID,NUMERIC,DATE)
TO authenticated, service_role;



-- ============================================================================
-- 3. Customer Role Validation Helper
-- ============================================================================

CREATE OR REPLACE FUNCTION public.assert_authenticated_context()

RETURNS VOID

LANGUAGE plpgsql

SECURITY DEFINER

SET search_path = pg_catalog, public, pg_temp

AS $$


BEGIN


IF auth.uid() IS NULL

AND current_user NOT IN
(
    'postgres',
    'service_role'
)

THEN

    RAISE EXCEPTION
    'Unauthenticated execution context rejected.';

END IF;



END;

$$;



REVOKE ALL ON FUNCTION public.assert_authenticated_context()

FROM PUBLIC;


GRANT EXECUTE ON FUNCTION public.assert_authenticated_context()

TO authenticated, service_role;



-- ============================================================================
-- 4. Secure Tenant Role Verification Wrapper
-- ============================================================================


CREATE OR REPLACE FUNCTION public.assert_tenant_role
(
    _tenant_id UUID,
    _roles TEXT[]
)


RETURNS BOOLEAN


LANGUAGE plpgsql


SECURITY DEFINER


SET search_path = pg_catalog, public, pg_temp


AS $$


BEGIN


PERFORM public.assert_authenticated_context();



RETURN EXISTS
(

    SELECT 1

    FROM unnest(_roles) role_name

    WHERE public.has_tenant_role
    (
        _tenant_id,
        role_name
    )

);


END;


$$;



REVOKE ALL ON FUNCTION public.assert_tenant_role(UUID,TEXT[])

FROM PUBLIC;


GRANT EXECUTE ON FUNCTION public.assert_tenant_role(UUID,TEXT[])

TO authenticated, service_role;



-- ============================================================================
-- 5. Meter Assignment Engine
-- ============================================================================


CREATE OR REPLACE FUNCTION public.assign_meter

(
    _customer_id UUID,

    _serial TEXT,

    _type TEXT DEFAULT 'water',

    _initial_index NUMERIC DEFAULT 0,

    _started_at TIMESTAMPTZ DEFAULT now()

)


RETURNS UUID


LANGUAGE plpgsql


SECURITY DEFINER


SET search_path = pg_catalog, public, pg_temp



AS $$


DECLARE


    _tenant_id UUID;

    _meter_id UUID;

    _assignment_id UUID;


BEGIN


PERFORM public.assert_authenticated_context();



SELECT tenant_id

INTO _tenant_id


FROM public.customers


WHERE id = _customer_id;


IF _tenant_id IS NULL THEN

    RAISE EXCEPTION
    'Customer not found';

END IF;



IF NOT public.assert_tenant_role
(
    _tenant_id,

    ARRAY[
        'staff',
        'manager',
        'admin',
        'collector',
        'meter_reader'
    ]
)

THEN

    RAISE EXCEPTION
    'Insufficient tenant privileges';

END IF;




-- Lock customer root resource

PERFORM public.acquire_customer_lock
(
    _tenant_id,
    _customer_id
);



SELECT id

INTO _meter_id


FROM public.meters


WHERE tenant_id = _tenant_id

AND serial = _serial


FOR UPDATE;



IF _meter_id IS NULL THEN


INSERT INTO public.meters
(
    tenant_id,
    serial,
    meter_type,
    initial_index
)

VALUES
(
    _tenant_id,
    _serial,
    _type,
    COALESCE(_initial_index,0)
)


RETURNING id INTO _meter_id;


END IF;



UPDATE public.meter_assignments

SET ended_at = _started_at


WHERE meter_id = _meter_id

AND ended_at IS NULL;




INSERT INTO public.meter_assignments
(
    tenant_id,
    customer_id,
    meter_id,
    started_at
)

VALUES
(
    _tenant_id,
    _customer_id,
    _meter_id,
    _started_at
)


RETURNING id INTO _assignment_id;



RETURN _assignment_id;



END;

$$;



REVOKE ALL ON FUNCTION public.assign_meter(UUID,TEXT,TEXT,NUMERIC,TIMESTAMPTZ)

FROM PUBLIC;


GRANT EXECUTE ON FUNCTION public.assign_meter(UUID,TEXT,TEXT,NUMERIC,TIMESTAMPTZ)

TO authenticated, service_role;



COMMIT;
