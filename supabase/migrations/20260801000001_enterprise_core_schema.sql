-- ============================================================================
-- MIZAN AI - Enterprise Utility Billing Engine
-- Migration #01: Enterprise Core Schema
-- Description:
--   Core financial schema foundation.
--   No data backfill execution.
--   No heavy operations.
--   Production-safe ordering.
--
-- Compatibility:
--   PostgreSQL 15+
--   Supabase Managed RLS
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Required Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";


-- ============================================================================
-- 2. Accounting Periods
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.accounting_periods (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id UUID NOT NULL
        REFERENCES public.tenants(id)
        ON DELETE RESTRICT,

    period_name TEXT NOT NULL,

    start_date DATE NOT NULL,

    end_date DATE NOT NULL,

    is_closed BOOLEAN NOT NULL DEFAULT false,

    closed_at TIMESTAMPTZ,

    closed_by UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_accounting_period_dates
        CHECK (end_date >= start_date),

    CONSTRAINT uq_accounting_period_name
        UNIQUE (tenant_id, period_name)
);


-- ============================================================================
-- 3. Historical Tariff Versions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tariff_versions (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    tenant_id UUID NOT NULL
        REFERENCES public.tenants(id)
        ON DELETE RESTRICT,

    tariff_id UUID NOT NULL
        REFERENCES public.tariffs(id)
        ON DELETE RESTRICT,

    effective_from DATE NOT NULL,

    effective_to DATE,

    rate_structure JSONB NOT NULL,

    created_at TIMESTAMPTZ DEFAULT now(),

    valid_period DATERANGE GENERATED ALWAYS AS
    (
        daterange(
            effective_from,
            COALESCE(
                effective_to,
                '9999-12-31'::DATE
            ),
            '[]'
        )
    ) STORED,


    CONSTRAINT chk_tariff_version_dates
    CHECK (
        effective_to IS NULL
        OR effective_to >= effective_from
    ),


    CONSTRAINT ex_tariff_version_overlap

    EXCLUDE USING gist
    (
        tenant_id WITH =,
        tariff_id WITH =,
        valid_period WITH &&
    )

);



-- ============================================================================
-- 4. Billing Adjustments
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.billing_adjustments (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),


    tenant_id UUID NOT NULL
        REFERENCES public.tenants(id)
        ON DELETE RESTRICT,


    customer_id UUID NOT NULL
        REFERENCES public.customers(id)
        ON DELETE RESTRICT,


    reading_id UUID
        REFERENCES public.water_readings(id)
        ON DELETE SET NULL,


    bill_id UUID
        REFERENCES public.water_bills(id)
        ON DELETE SET NULL,


    type TEXT NOT NULL
        CHECK (
            type IN
            (
                'credit_note',
                'debit_note',
                'refund'
            )
        ),


    amount NUMERIC(18,3) NOT NULL
        CHECK(amount > 0),


    reason TEXT NOT NULL,


    status TEXT NOT NULL DEFAULT 'pending'
        CHECK
        (
            status IN
            (
                'pending',
                'approved',
                'rejected'
            )
        ),


    created_by UUID DEFAULT auth.uid(),

    approved_by UUID,


    created_at TIMESTAMPTZ DEFAULT now()

);



-- ============================================================================
-- 5. Immutable Double Entry Customer Ledger
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.customer_ledger (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),


    tenant_id UUID NOT NULL
        REFERENCES public.tenants(id)
        ON DELETE RESTRICT,


    customer_id UUID NOT NULL
        REFERENCES public.customers(id)
        ON DELETE RESTRICT,


    entry_type TEXT NOT NULL
        CHECK
        (
            entry_type IN
            (
                'bill',
                'payment',
                'credit_note',
                'debit_note',
                'refund'
            )
        ),


    reference_id UUID NOT NULL,


    debit_amount NUMERIC(18,3)
        NOT NULL DEFAULT 0.000
        CHECK(debit_amount >= 0),


    credit_amount NUMERIC(18,3)
        NOT NULL DEFAULT 0.000
        CHECK(credit_amount >= 0),


    running_balance NUMERIC(18,3)
        NOT NULL DEFAULT 0.000,


    description TEXT,


    posted_at TIMESTAMPTZ
        NOT NULL DEFAULT now(),



    CONSTRAINT chk_double_entry_direction

    CHECK
    (
        (
            debit_amount > 0
            AND credit_amount = 0
        )

        OR

        (
            credit_amount > 0
            AND debit_amount = 0
        )
    ),



    CONSTRAINT uq_customer_ledger_reference

    UNIQUE
    (
        tenant_id,
        reference_id,
        entry_type
    )

);



-- ============================================================================
-- 6. Water Bills Extensions
-- ============================================================================

ALTER TABLE public.water_bills

ADD COLUMN IF NOT EXISTS bill_number TEXT,

ADD COLUMN IF NOT EXISTS due_date DATE
DEFAULT CURRENT_DATE + INTERVAL '14 days',

ADD COLUMN IF NOT EXISTS subtotal NUMERIC(18,3)
DEFAULT 0.000,

ADD COLUMN IF NOT EXISTS arrears_snapshot NUMERIC(18,3)
DEFAULT 0.000,

ADD COLUMN IF NOT EXISTS net_amount NUMERIC(18,3)
DEFAULT 0.000,

ADD COLUMN IF NOT EXISTS tariff_version_id UUID
REFERENCES public.tariff_versions(id)
ON DELETE RESTRICT,

ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ
DEFAULT now(),

ADD COLUMN IF NOT EXISTS created_by UUID
DEFAULT auth.uid();



DO $$

BEGIN

IF NOT EXISTS
(
SELECT 1
FROM pg_constraint
WHERE conname='uq_water_bill_reading'
)

THEN

ALTER TABLE public.water_bills

ADD CONSTRAINT uq_water_bill_reading

UNIQUE(reading_id);

END IF;

END $$;



-- ============================================================================
-- 7. Reading Chain Marker
-- ============================================================================

ALTER TABLE public.water_readings

ADD COLUMN IF NOT EXISTS is_chained BOOLEAN DEFAULT false;



-- ============================================================================
-- 8. Performance Indexes
-- ============================================================================


CREATE INDEX IF NOT EXISTS idx_accounting_period_lookup

ON public.accounting_periods
(
tenant_id,
start_date,
end_date,
is_closed
);



CREATE INDEX IF NOT EXISTS idx_customer_ledger_lookup

ON public.customer_ledger
(
tenant_id,
customer_id,
posted_at DESC,
id DESC
);



CREATE INDEX IF NOT EXISTS idx_tariff_version_lookup

ON public.tariff_versions
(
tenant_id,
tariff_id,
effective_from
);



CREATE INDEX IF NOT EXISTS idx_adjustments_lookup

ON public.billing_adjustments
(
tenant_id,
customer_id,
status
);



-- ============================================================================
-- 9. Enable RLS
-- ============================================================================

ALTER TABLE public.accounting_periods
ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.tariff_versions
ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.billing_adjustments
ENABLE ROW LEVEL SECURITY;


ALTER TABLE public.customer_ledger
ENABLE ROW LEVEL SECURITY;



COMMIT;
