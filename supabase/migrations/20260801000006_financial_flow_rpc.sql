-- Migration #06: Production Financial Flow RPCs (Final Hardened Version)
-- Description: Encapsulates all sensitive financial entries inside secure PostgreSQL functions.
-- Guarantees: Role validation, Overpayment Protection, Concurrency Locking, Double-Approval Protection, Ledger & Balance Consistency.

BEGIN;

-- ============================================================================
-- 1. RPC: process_payment_entry
-- Description: Submits a new payment entry in 'pending' status without altering ledger/balances.
-- Authorized Roles: collector, admin, manager, accountant, super_admin.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_payment_entry(
  _bill_id UUID,
  _amount NUMERIC(18,3),
  _method TEXT,
  _collected_by TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  _customer_id UUID;
  _tenant_id UUID;
  _payment_id UUID;
  _authenticated_user_id UUID;
BEGIN
  -- 1. التحقق من وجود جلسة توثيق حساسة
  PERFORM public.assert_authenticated_context();
  _authenticated_user_id := auth.uid();

  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Invalid payment amount: Must be greater than zero.';
  END IF;

  -- 2. جلب بيانات الفاتورة والمستأجر للتأكد من المرجعية
  SELECT customer_id, tenant_id INTO _customer_id, _tenant_id
  FROM public.water_bills
  WHERE id = _bill_id;

  IF _customer_id IS NULL THEN
    RAISE EXCEPTION 'Target invoice not found for ID: %', _bill_id;
  END IF;

  -- 3. التحقق من صلاحية دور المستخدم على مستوى المستأجر
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = _tenant_id
      AND user_id = _authenticated_user_id
      AND role::TEXT IN ('collector', 'admin', 'manager', 'accountant', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized action: User does not have a valid collection role for this tenant.';
  END IF;

  -- 4. إدراج حركة السداد بحالة "معلقة" حصراً
  INSERT INTO public.payments (
    bill_id,
    customer_id,
    tenant_id,
    amount,
    method,
    status,
    collected_by,
    payment_date,
    created_at,
    updated_at
  )
  VALUES (
    _bill_id,
    _customer_id,
    _tenant_id,
    ROUND(_amount, 3),
    _method,
    'pending'::public.payment_status,
    COALESCE(_collected_by, 'System Collector'),
    NOW(),
    NOW(),
    NOW()
  )
  RETURNING id INTO _payment_id;

  RETURN _payment_id;
END;
$$;

-- ============================================================================
-- 2. RPC: approve_payment_transaction
-- Description: Locks customer account, posts ledger entry, recalculates balance, and updates bill status safely.
-- Protection: Prevents overpayment (paid_amount <= total) and double approval.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.approve_payment_transaction(_payment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  _p RECORD;
  _authenticated_user_id UUID;
  _current_paid NUMERIC(18,3);
  _bill_total NUMERIC(18,3);
  _calculated_paid NUMERIC(18,3);
  _final_paid NUMERIC(18,3);
  _new_bill_status TEXT;
BEGIN
  -- 1. التحقق من وجود جلسة توثيق حساسة
  PERFORM public.assert_authenticated_context();
  _authenticated_user_id := auth.uid();

  -- 2. جلب الحركة مع قفل الصف لمنع سباق الاعتماد المزدوج (Double-Approval Protection)
  SELECT * INTO _p 
  FROM public.payments 
  WHERE id = _payment_id 
  FOR UPDATE;

  IF _p.id IS NULL THEN
    RAISE EXCEPTION 'Payment record % not found.', _payment_id;
  END IF;

  -- 3. الحماية ضد الاعتماد المكرر أو الحركات غير المعلقة
  IF _p.status = 'approved' THEN
    RAISE NOTICE 'Payment % is already approved.', _payment_id;
    RETURN;
  END IF;

  IF _p.status = 'rejected' THEN
    RAISE EXCEPTION 'Cannot approve a payment that has already been rejected.';
  END IF;

  -- 4. التحقق من الصلاحيات الأمنية (يتطلب دور Admin أو Manager أو Accountant في المستأجر)
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = _p.tenant_id
      AND user_id = _authenticated_user_id
      AND role::TEXT IN ('admin', 'manager', 'super_admin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Unauthorized action: Insufficient privileges to approve financial payments.';
  END IF;

  -- 5. تفعيل الأقفال التضامنية للعميل لمنع التضارب التزامني عند تعديل الأرصدة
  PERFORM public.acquire_customer_lock(_p.tenant_id, _p.customer_id);

  -- 6. تحديث حالة الحركة إلى 'approved'
  UPDATE public.payments 
  SET status = 'approved'::public.payment_status,
      updated_at = NOW() 
  WHERE id = _payment_id;

  -- 7. إدراج القيد في دفتر الأستاذ (Customer Ledger) - حقل الدائن (credit_amount)
  INSERT INTO public.customer_ledger (
    tenant_id,
    customer_id,
    entry_type,
    reference_id,
    debit_amount,
    credit_amount,
    description,
    posted_at,
    created_at
  ) VALUES (
    _p.tenant_id,
    _p.customer_id,
    'payment',
    _payment_id,
    0.000,
    ROUND(_p.amount, 3),
    FORMAT('اعتماد سداد فاتورة بمبلغ %s', ROUND(_p.amount, 3)),
    NOW(),
    NOW()
  );

  -- 8. إعادة حساب وتحديث جدول customer_balances و customers بشكل آمن
  PERFORM public.recalc_customer_balance(_p.customer_id);

  -- 9. جلب قفل الفاتورة المرتبطة وتحديث المبالغ وحالتها مع حماية التجاوز (Overpayment Protection)
  SELECT total, COALESCE(paid_amount, 0.000) 
  INTO _bill_total, _current_paid
  FROM public.water_bills
  WHERE id = _p.bill_id
  FOR UPDATE;

  IF _bill_total IS NOT NULL THEN
    _calculated_paid := ROUND(_current_paid + _p.amount, 3);
    
    -- حماية tمنع أن يتجاوز paid_amount قيمة total في water_bills
    IF _calculated_paid >= _bill_total THEN
      _final_paid := _bill_total;
      _new_bill_status := 'paid'::TEXT;
    ELSE
      _final_paid := _calculated_paid;
      _new_bill_status := 'partially_paid'::TEXT;
    END IF;

    UPDATE public.water_bills
    SET paid_amount = _final_paid,
        status = _new_bill_status,
        updated_at = NOW()
    WHERE id = _p.bill_id;
  END IF;

END;
$$;

-- ============================================================================
-- 3. RPC: reject_payment_transaction
-- Description: Rejects a pending payment transaction safely.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reject_payment_transaction(_payment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  _p RECORD;
  _authenticated_user_id UUID;
BEGIN
  -- 1. التحقق من وجود جلسة توثيق حساسة
  PERFORM public.assert_authenticated_context();
  _authenticated_user_id := auth.uid();

  -- 2. جلب الحركة المحددة
  SELECT * INTO _p 
  FROM public.payments 
  WHERE id = _payment_id 
  FOR UPDATE;

  IF _p.id IS NULL THEN
    RAISE EXCEPTION 'Payment record % not found.', _payment_id;
  END IF;

  IF _p.status = 'approved' THEN
    RAISE EXCEPTION 'Cannot reject an already approved payment transaction.';
  END IF;

  -- 3. التحقق من الصلاحيات للأدوار الحاكمة للمستأجر
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE tenant_id = _p.tenant_id
      AND user_id = _authenticated_user_id
      AND role::TEXT IN ('admin', 'manager', 'super_admin', 'accountant')
  ) THEN
    RAISE EXCEPTION 'Unauthorized action: Insufficient privileges to reject financial payments.';
  END IF;

  -- 4. تحويل حالة الدفعة إلى مرفوضة
  UPDATE public.payments 
  SET status = 'rejected'::public.payment_status,
      updated_at = NOW() 
  WHERE id = _payment_id AND status = 'pending'::public.payment_status;

END;
$$;

-- منح صلاحيات التنفيذ للمستخدمين الموثقين
GRANT EXECUTE ON FUNCTION public.process_payment_entry(UUID, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_payment_transaction(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_payment_transaction(UUID) TO authenticated;

COMMIT;
