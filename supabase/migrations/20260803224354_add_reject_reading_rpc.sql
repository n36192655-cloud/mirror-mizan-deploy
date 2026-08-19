/*
# Add missing reject_reading RPC

## Problem
The frontend calls `reject_reading(_reading_id, _reason)` from both the
readings page and the store, but this function does not exist in the
database.  The migration file `20260803193913_add_reject_reading_rpc.sql`
was written on disk but never applied — the Supabase migration runner is
not available in this environment, so the function was never created.

## What this migration does
1. Creates `public.reject_reading(_reading_id uuid, _reason text DEFAULT NULL)`
   as a SECURITY DEFINER plpgsql function.
2. Verifies the caller has the `manager` role for the reading's tenant.
3. If a bill is linked to the reading:
   - Rejects if the bill already has approved payments (cannot undo).
   - Deletes pending payments on that bill.
   - Voids the bill (`status = 'void'`).
4. Sets the reading `status = 'rejected'`, `flag = 'error'`.
5. Recalculates the customer balance after voiding the bill.

## Security
- SECURITY DEFINER with `search_path = 'public'`.
- Uses `has_tenant_role` to enforce manager-only access.
- REVOKE ALL FROM PUBLIC, GRANT EXECUTE TO authenticated + service_role.
*/

CREATE OR REPLACE FUNCTION public.reject_reading(_reading_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  _tid UUID;
  _bill_id UUID;
BEGIN
  SELECT tenant_id INTO _tid FROM public.water_readings WHERE id = _reading_id;
  IF _tid IS NULL THEN RAISE EXCEPTION 'reading not found'; END IF;
  IF NOT public.has_tenant_role(_tid, 'manager') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Void any bill linked to this reading (if no approved payments on it)
  SELECT id INTO _bill_id FROM public.water_bills WHERE reading_id = _reading_id LIMIT 1;
  IF _bill_id IS NOT NULL THEN
    -- Check for approved payments
    PERFORM 1 FROM public.payments WHERE bill_id = _bill_id AND status = 'approved' LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'cannot reject reading: bill already has approved payments';
    END IF;
    -- Delete pending payments and void the bill
    DELETE FROM public.payments WHERE bill_id = _bill_id AND status = 'pending';
    UPDATE public.water_bills SET status = 'void' WHERE id = _bill_id;
  END IF;

  UPDATE public.water_readings
  SET status = 'rejected', flag = 'error'
  WHERE id = _reading_id;

  -- Recalculate customer balance after voiding bill
  PERFORM public.recalc_customer_balance(
    (SELECT customer_id FROM public.water_readings WHERE id = _reading_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_reading(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_reading(uuid, text) TO authenticated, service_role;