CREATE OR REPLACE FUNCTION public.recalc_customer_balance(_customer_id uuid)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _bal NUMERIC;
BEGIN
  IF _customer_id IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(GREATEST(total - paid_amount, 0)), 0) INTO _bal
    FROM public.water_bills WHERE customer_id = _customer_id AND status <> 'paid';
  UPDATE public.customers SET balance = _bal WHERE id = _customer_id;
  RETURN _bal;
END; $fn$;

CREATE OR REPLACE FUNCTION public.issue_bill_for_reading(_reading water_readings)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _subtotal NUMERIC; _arrears NUMERIC; _bill_id UUID;
BEGIN
  IF _reading.customer_id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO _bill_id FROM public.water_bills WHERE reading_id = _reading.id LIMIT 1;
  IF _bill_id IS NOT NULL THEN RETURN _bill_id; END IF;

  _subtotal := public.price_consumption(_reading.tenant_id, COALESCE(_reading.consumption,0));
  SELECT COALESCE(SUM(GREATEST(total - paid_amount, 0)), 0) INTO _arrears
    FROM public.water_bills
   WHERE customer_id = _reading.customer_id AND status <> 'paid';

  INSERT INTO public.water_bills (
    tenant_id, customer_id, reading_id, amount, subtotal, arrears, total, status, issued_at
  ) VALUES (
    _reading.tenant_id, _reading.customer_id, _reading.id,
    _subtotal, _subtotal, _arrears, _subtotal, 'unpaid', now()
  ) RETURNING id INTO _bill_id;

  PERFORM public.recalc_customer_balance(_reading.customer_id);
  RETURN _bill_id;
END; $fn$;

CREATE OR REPLACE FUNCTION public.approve_payment(_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  _uid UUID := auth.uid();
  _pay public.payments%ROWTYPE; _bill public.water_bills%ROWTYPE;
  _approved NUMERIC; _new_paid NUMERIC; _new_status TEXT;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found'; END IF;
  IF _pay.status <> 'pending' THEN RAISE EXCEPTION 'payment is not pending'; END IF;
  IF _pay.bill_id IS NULL THEN RAISE EXCEPTION 'payment has no bill'; END IF;
  IF NOT public.has_tenant_role(_pay.tenant_id, 'manager') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO _bill FROM public.water_bills WHERE id = _pay.bill_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bill not found'; END IF;

  SELECT COALESCE(SUM(amount),0) INTO _approved FROM public.payments
   WHERE bill_id = _bill.id AND status = 'approved';
  _new_paid := _approved + _pay.amount;
  IF _new_paid > _bill.total + 0.0001 THEN RAISE EXCEPTION 'approval would exceed bill total'; END IF;

  _new_status := CASE WHEN _new_paid >= _bill.total - 0.0001 THEN 'paid'
                      WHEN _new_paid > 0 THEN 'partial' ELSE 'unpaid' END;

  UPDATE public.payments SET status='approved', approved_at=now(), approved_by=_uid WHERE id=_pay.id;
  UPDATE public.water_bills
     SET paid_amount=_new_paid, status=_new_status,
         paid_at = CASE WHEN _new_status='paid' THEN now() ELSE paid_at END
   WHERE id=_bill.id;

  PERFORM public.recalc_customer_balance(_bill.customer_id);
END; $fn$;

CREATE OR REPLACE FUNCTION public.reject_payment(_payment_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE _uid UUID := auth.uid(); _pay public.payments%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found'; END IF;
  IF _pay.status <> 'pending' THEN RAISE EXCEPTION 'only pending payments can be rejected'; END IF;
  IF NOT public.has_tenant_role(_pay.tenant_id, 'manager') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.payments SET status='rejected', rejected_at=now(), rejected_by=_uid, reject_reason=_reason
   WHERE id=_pay.id;
  PERFORM public.recalc_customer_balance(_pay.customer_id);
END; $fn$;

REVOKE ALL ON FUNCTION public.recalc_customer_balance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_payment(uuid, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_payment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_payment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_reading(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.issue_bill_for_reading(public.water_readings) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.price_consumption(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_device_slot(text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.record_payment(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_reading(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.price_consumption(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_device_slot(text, text, text) TO authenticated;