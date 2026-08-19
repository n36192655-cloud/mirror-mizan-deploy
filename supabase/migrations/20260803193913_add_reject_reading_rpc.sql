-- Add missing reject_reading RPC
-- The frontend calls reject_reading(_reading_id, _reason) but it doesn't exist.
CREATE OR REPLACE FUNCTION public.reject_reading(_reading_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
