DROP FUNCTION IF EXISTS public.recalc_customer_balance(uuid);
CREATE OR REPLACE FUNCTION public.recalc_customer_balance(_customer_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _bal NUMERIC;
BEGIN
  IF _customer_id IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(GREATEST(total - paid_amount, 0)), 0) INTO _bal
    FROM public.water_bills WHERE customer_id = _customer_id AND status <> 'paid';
  UPDATE public.customers SET balance = _bal WHERE id = _customer_id;
  RETURN _bal;
END; $function$;