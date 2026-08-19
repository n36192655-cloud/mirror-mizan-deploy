-- ============================================================================
-- MIZAN AI - Enterprise Utility Billing Engine
-- Migration #03: Immutable Financial Pipeline & Transaction Triggers
--
-- Description:
--   Financial immutability.
--   Safe ledger posting.
--   Reading validation pipeline.
--   Invoice issuance.
--   Payment approval.
--
-- Compatibility:
--   PostgreSQL 15+
--   Supabase Managed RLS
-- ============================================================================


BEGIN;



-- ============================================================================
-- 1. Frozen Invoice Protection
-- ============================================================================


CREATE OR REPLACE FUNCTION public.tg_protect_frozen_invoices()

RETURNS TRIGGER

LANGUAGE plpgsql

SECURITY DEFINER

SET search_path = pg_catalog, public, pg_temp


AS $$


BEGIN


IF OLD.status IN
(
    'paid',
    'partially_paid',
    'void'
)

AND

(
    ROUND(NEW.subtotal,3)
    IS DISTINCT FROM
    ROUND(OLD.subtotal,3)

    OR

    ROUND(NEW.total,3)
    IS DISTINCT FROM
    ROUND(OLD.total,3)

    OR

    ROUND(NEW.amount,3)
    IS DISTINCT FROM
    ROUND(OLD.amount,3)
)

THEN


RAISE EXCEPTION

'Financial Security: Frozen invoices cannot be modified. Use billing_adjustments.';


END IF;



RETURN NEW;


END;

$$;



DROP TRIGGER IF EXISTS trg_protect_frozen_invoices
ON public.water_bills;



CREATE TRIGGER trg_protect_frozen_invoices

BEFORE UPDATE ON public.water_bills

FOR EACH ROW

EXECUTE FUNCTION public.tg_protect_frozen_invoices();





-- ============================================================================
-- 2. Immutable Ledger Protection
-- ============================================================================


CREATE OR REPLACE FUNCTION public.tg_prevent_ledger_mutation()


RETURNS TRIGGER

LANGUAGE plpgsql

SECURITY DEFINER

SET search_path = pg_catalog, public, pg_temp


AS $$


BEGIN


RAISE EXCEPTION

'Financial Security Violation: Ledger entries are immutable.';


END;


$$;



DROP TRIGGER IF EXISTS trg_prevent_ledger_update
ON public.customer_ledger;


CREATE TRIGGER trg_prevent_ledger_update

BEFORE UPDATE ON public.customer_ledger

FOR EACH ROW

EXECUTE FUNCTION public.tg_prevent_ledger_mutation();



DROP TRIGGER IF EXISTS trg_prevent_ledger_delete
ON public.customer_ledger;


CREATE TRIGGER trg_prevent_ledger_delete

BEFORE DELETE ON public.customer_ledger

FOR EACH ROW

EXECUTE FUNCTION public.tg_prevent_ledger_mutation();





-- ============================================================================
-- 3. Billing Adjustment Ledger Posting
-- ============================================================================


CREATE OR REPLACE FUNCTION public.tg_post_adjustment_to_ledger()


RETURNS TRIGGER


LANGUAGE plpgsql


SECURITY DEFINER


SET search_path = pg_catalog, public, pg_temp


AS $$


DECLARE


_debit NUMERIC(18,3) := 0;

_credit NUMERIC(18,3) := 0;

_current_balance NUMERIC(18,3);



BEGIN



PERFORM public.assert_authenticated_context();



IF TG_OP = 'UPDATE'

AND OLD.status='pending'

AND NEW.status='approved'


THEN



IF NOT public.assert_tenant_role

(
NEW.tenant_id,

ARRAY[
'admin',
'manager'
]

)

THEN


RAISE EXCEPTION

'Only manager/admin can approve adjustments.';


END IF;



IF NEW.type='debit_note'

THEN

_debit := NEW.amount;


ELSIF NEW.type IN
(
'credit_note',
'refund'
)

THEN

_credit := NEW.amount;


END IF;



PERFORM public.acquire_customer_lock
(
NEW.tenant_id,
NEW.customer_id
);



SELECT current_balance

INTO _current_balance


FROM public.customer_balances


WHERE tenant_id=NEW.tenant_id

AND customer_id=NEW.customer_id;



INSERT INTO public.customer_ledger

(
tenant_id,
customer_id,
entry_type,
reference_id,
debit_amount,
credit_amount,
running_balance,
description
)

VALUES

(
NEW.tenant_id,
NEW.customer_id,
NEW.type,
NEW.id,
_debit,
_credit,
COALESCE(_current_balance,0)+(_debit-_credit),
NEW.reason
)


ON CONFLICT DO NOTHING;



PERFORM public.recalc_customer_balance
(
NEW.customer_id
);



END IF;



RETURN NEW;


END;


$$;



DROP TRIGGER IF EXISTS trg_post_adjustment_to_ledger

ON public.billing_adjustments;



CREATE TRIGGER trg_post_adjustment_to_ledger

AFTER INSERT OR UPDATE

ON public.billing_adjustments

FOR EACH ROW

EXECUTE FUNCTION public.tg_post_adjustment_to_ledger();





-- ============================================================================
-- 4. Meter Reading Validation Pipeline
-- ============================================================================


CREATE OR REPLACE FUNCTION public.tg_reading_before_insert()


RETURNS TRIGGER


LANGUAGE plpgsql


SECURITY DEFINER


SET search_path = pg_catalog, public, pg_temp


AS $$



DECLARE


_previous NUMERIC;

_initial NUMERIC;

_customer UUID;

_tenant UUID;

_average NUMERIC;


BEGIN



PERFORM public.assert_authenticated_context();



IF NEW.meter_id IS NULL THEN

RAISE EXCEPTION 'meter_id required';

END IF;



SELECT tenant_id, initial_index

INTO _tenant,_initial


FROM public.meters

WHERE id=NEW.meter_id

FOR UPDATE;



IF _tenant IS NULL THEN

RAISE EXCEPTION 'Meter not found';

END IF;



NEW.tenant_id := _tenant;



IF public.is_period_closed
(
_tenant,
NEW.reading_date
)

THEN

RAISE EXCEPTION

'Closed accounting period';


END IF;



SELECT customer_id

INTO _customer


FROM public.meter_assignments


WHERE meter_id=NEW.meter_id


AND started_at::date<=NEW.reading_date


AND
(
ended_at IS NULL

OR

ended_at::date>=NEW.reading_date
)

ORDER BY started_at DESC

LIMIT 1;



IF _customer IS NULL THEN

RAISE EXCEPTION

'No active meter assignment';

END IF;



NEW.customer_id := _customer;



PERFORM public.acquire_customer_lock
(
_tenant,
_customer
);



IF NEW.previous IS NULL THEN


SELECT current_reading

INTO _previous


FROM public.water_readings


WHERE meter_id=NEW.meter_id


AND status<>'rejected'


ORDER BY reading_date DESC


LIMIT 1;



NEW.previous :=
COALESCE(_previous,_initial,0);



END IF;



NEW.consumption :=

GREATEST
(
NEW.current_reading
-
NEW.previous,
0
);



SELECT AVG(consumption)

INTO _average


FROM public.water_readings


WHERE meter_id=NEW.meter_id

AND status='approved';



IF _average IS NOT NULL

AND NEW.consumption > (_average*3)

THEN


NEW.flag='suspicious';

NEW.status='pending_approval';


ELSE


NEW.flag='ok';

NEW.status='approved';


END IF;



RETURN NEW;



END;

$$;



DROP TRIGGER IF EXISTS tg_reading_before_insert

ON public.water_readings;



CREATE TRIGGER tg_reading_before_insert

BEFORE INSERT ON public.water_readings

FOR EACH ROW

EXECUTE FUNCTION public.tg_reading_before_insert();





COMMIT;
