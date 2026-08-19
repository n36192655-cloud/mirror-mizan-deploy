-- Fix critical accounting bug: total must be subtotal + arrears
-- The original function set total = _subtotal, ignoring arrears entirely.
-- This means bills were missing overdue amounts from previous unpaid bills.
CREATE OR REPLACE FUNCTION public.issue_bill_for_reading(_reading water_readings)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _subtotal NUMERIC; _arrears NUMERIC; _bill_id UUID;
BEGIN
IF _reading.customer_id IS NULL THEN RETURN NULL; END IF;
SELECT id INTO _bill_id FROM public.water_bills WHERE reading_id = _reading.id LIMIT 1;
IF _bill_id IS NOT NULL THEN RETURN _bill_id; END IF;

_subtotal := public.price_consumption(_reading.tenant_id, COALESCE(_reading.consumption,0));
SELECT COALESCE(SUM(GREATEST(total - paid_amount, 0)), 0) INTO _arrears
FROM public.water_bills
WHERE customer_id = _reading.customer_id AND status <> 'paid' AND status <> 'void';

INSERT INTO public.water_bills (
  tenant_id, customer_id, reading_id, amount, subtotal, arrears, total, status, issued_at
) VALUES (
  _reading.tenant_id, _reading.customer_id, _reading.id,
  _subtotal, _subtotal, _arrears, _subtotal + _arrears, 'unpaid', now()
) RETURNING id INTO _bill_id;

PERFORM public.recalc_customer_balance(_reading.customer_id);
RETURN _bill_id;
END;
$function$;
