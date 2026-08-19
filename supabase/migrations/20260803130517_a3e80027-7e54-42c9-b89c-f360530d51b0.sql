CREATE OR REPLACE FUNCTION public.approve_reading(_reading_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r public.water_readings%ROWTYPE; _bill_id UUID;
BEGIN
  SELECT * INTO _r FROM public.water_readings WHERE id = _reading_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reading not found'; END IF;
  IF NOT public.has_tenant_role(_r.tenant_id, 'manager') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _r.status <> 'pending_approval' THEN RAISE EXCEPTION 'reading is not pending approval'; END IF;

  UPDATE public.water_readings
     SET status='approved', approved_at=now(), approved_by=auth.uid()
   WHERE id=_reading_id
  RETURNING * INTO _r;

  -- issue the bill inside the same transaction (idempotent: returns existing bill if any)
  _bill_id := public.issue_bill_for_reading(_r);

  IF _r.customer_id IS NOT NULL THEN
    PERFORM public.recalc_customer_balance(_r.customer_id);
  END IF;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, details)
  VALUES (_r.tenant_id, auth.uid(), 'reading.approve', 'water_readings', _reading_id,
          jsonb_build_object('flag', _r.flag, 'consumption', _r.consumption, 'bill_id', _bill_id));
END; $function$;