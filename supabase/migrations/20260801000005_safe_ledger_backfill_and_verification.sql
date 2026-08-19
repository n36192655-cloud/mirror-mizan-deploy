-- ============================================================================
-- MIZAN AI - Enterprise Utility Billing Engine
-- Migration #05: Safe Ledger Backfill & Financial Verification
--
-- Description:
--   Isolated ledger migration.
--   Deterministic financial reconstruction.
--   Integrity verification.
--
-- Compatibility:
--   PostgreSQL 15+
--   Supabase
-- ============================================================================


BEGIN;



-- ============================================================================
-- 1. Safe Ledger Backfill Function
-- ============================================================================


CREATE OR REPLACE FUNCTION public.execute_ledger_backfill()


RETURNS TABLE
(
    processed_records BIGINT,
    skipped_records BIGINT
)


LANGUAGE plpgsql


SECURITY DEFINER


SET search_path = pg_catalog, public, pg_temp


AS $$


DECLARE


_initial_count BIGINT;

_final_count BIGINT;

_processed BIGINT;

_skipped BIGINT := 0;



BEGIN



PERFORM public.assert_authenticated_context();



SELECT COUNT(*)

INTO _initial_count

FROM public.customer_ledger;





WITH historical_entries AS
(


    /*
       Historical invoices
    */

    SELECT

        b.tenant_id,

        b.customer_id,

        'bill'::TEXT AS entry_type,

        b.id AS reference_id,


        ROUND
        (
            COALESCE
            (
                b.total,
                b.amount,
                0
            )::NUMERIC,

            3
        )

        AS debit_amount,


        0.000::NUMERIC(18,3)

        AS credit_amount,


        'Historical Bill Migration'

        AS description,


        COALESCE
        (
            b.issued_at,
            b.created_at
        )

        AS posted_at


    FROM public.water_bills b


    WHERE b.status <> 'void'





UNION ALL





    /*
       Historical payments
    */


    SELECT


        p.tenant_id,

        p.customer_id,

        'payment'::TEXT,

        p.id,


        0.000::NUMERIC(18,3),


        ROUND
        (
            p.amount::NUMERIC,

            3
        ),


        'Historical Payment Migration',


        COALESCE
        (
            p.paid_at::TIMESTAMPTZ,
            p.created_at
        )


    FROM public.payments p


    WHERE p.status='approved'


),





ordered_entries AS

(

SELECT


tenant_id,

customer_id,

entry_type,

reference_id,

debit_amount,

credit_amount,


SUM
(
debit_amount-credit_amount
)

OVER

(

PARTITION BY tenant_id,customer_id


ORDER BY

posted_at ASC,

entry_type ASC,

reference_id ASC

)

AS running_balance,


description,

posted_at



FROM historical_entries


)





INSERT INTO public.customer_ledger

(

tenant_id,

customer_id,

entry_type,

reference_id,

debit_amount,

credit_amount,

running_balance,

description,

posted_at

)


SELECT


tenant_id,

customer_id,

entry_type,

reference_id,

debit_amount,

credit_amount,

running_balance,

description,

posted_at


FROM ordered_entries



ON CONFLICT
(
tenant_id,
reference_id,
entry_type
)

DO NOTHING;





SELECT COUNT(*)

INTO _final_count

FROM public.customer_ledger;




_processed := _final_count-_initial_count;





/*
   Rebuild customer balances
*/

PERFORM public.recalc_customer_balance(c.id)

FROM public.customers c;




RETURN QUERY

SELECT

_processed,

_skipped;



END;


$$;





REVOKE ALL ON FUNCTION public.execute_ledger_backfill()

FROM PUBLIC;



GRANT EXECUTE ON FUNCTION public.execute_ledger_backfill()

TO service_role;






-- ============================================================================
-- 2. Execute Backfill
-- ============================================================================


SELECT *

FROM public.execute_ledger_backfill();






-- ============================================================================
-- 3. Financial Integrity Verification
-- ============================================================================


CREATE OR REPLACE FUNCTION public.verify_financial_integrity()


RETURNS TABLE

(
check_name TEXT,

status TEXT,

details TEXT

)



LANGUAGE plpgsql


SECURITY DEFINER


SET search_path = pg_catalog,public,pg_temp



AS $$


DECLARE


_balance_errors INTEGER;

_negative_errors INTEGER;

_orphan_errors INTEGER;

_duplicate_errors INTEGER;



BEGIN





-- ============================================================
-- Check 1: Balance Synchronization
-- ============================================================


SELECT COUNT(*)

INTO _balance_errors


FROM public.customer_balances cb


JOIN

(

SELECT

customer_id,

SUM
(
debit_amount-credit_amount
)

AS ledger_balance


FROM public.customer_ledger


GROUP BY customer_id


) l


ON l.customer_id=cb.customer_id



WHERE ROUND(cb.current_balance,3)

<>

ROUND(l.ledger_balance,3);





IF _balance_errors=0 THEN


RETURN QUERY SELECT

'Customer Balance Synchronization',

'PASSED',

'All balances match ledger';



ELSE


RETURN QUERY SELECT

'Customer Balance Synchronization',

'FAILED',

FORMAT
(
'%s mismatches detected',
_balance_errors
);



END IF;







-- ============================================================
-- Check 2: Negative Amount Protection
-- ============================================================



SELECT COUNT(*)

INTO _negative_errors


FROM public.customer_ledger


WHERE debit_amount < 0

OR credit_amount < 0;




IF _negative_errors=0 THEN


RETURN QUERY SELECT

'Ledger Negative Values',

'PASSED',

'No negative financial values';



ELSE


RETURN QUERY SELECT

'Ledger Negative Values',

'FAILED',

FORMAT
(
'%s invalid rows',
_negative_errors
);



END IF;






-- ============================================================
-- Check 3: Foreign Key Integrity
-- ============================================================



SELECT COUNT(*)

INTO _orphan_errors


FROM public.customer_ledger l


LEFT JOIN public.customers c

ON c.id=l.customer_id


WHERE c.id IS NULL;





IF _orphan_errors=0 THEN


RETURN QUERY SELECT

'Ledger Customer References',

'PASSED',

'All ledger rows have customers';



ELSE


RETURN QUERY SELECT

'Ledger Customer References',

'FAILED',

FORMAT
(
'%s orphan rows',
_orphan_errors
);



END IF;






-- ============================================================
-- Check 4: Duplicate Financial References
-- ============================================================



SELECT COUNT(*)

INTO _duplicate_errors


FROM

(

SELECT

tenant_id,

reference_id,

entry_type,

COUNT(*)

FROM public.customer_ledger


GROUP BY

tenant_id,

reference_id,

entry_type


HAVING COUNT(*)>1


) d;





IF _duplicate_errors=0 THEN


RETURN QUERY SELECT

'Ledger Duplicate References',

'PASSED',

'No duplicate financial postings';



ELSE


RETURN QUERY SELECT

'Ledger Duplicate References',

'FAILED',

FORMAT
(
'%s duplicate groups',
_duplicate_errors
);



END IF;



END;


$$;





REVOKE ALL ON FUNCTION public.verify_financial_integrity()

FROM PUBLIC;



GRANT EXECUTE ON FUNCTION public.verify_financial_integrity()

TO authenticated,service_role;






-- ============================================================================
-- 4. Run Verification
-- ============================================================================


SELECT *

FROM public.verify_financial_integrity();





COMMIT;
