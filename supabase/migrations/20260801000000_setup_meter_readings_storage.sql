-- ============================================================================
-- Migration: 20260801000000_setup_meter_readings_storage.sql
-- Description: Setup secure Supabase Storage Bucket for meter reading images
--              with strict organization-level RLS policies and mime limits.
-- ============================================================================

-- 1. إنشاء الـ Bucket المخصص لصور العدادات مع قيود الحجم وأنواع الملفات
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'meter-readings',
  'meter-readings',
  false, -- غير متاح للعموم إلا عبر السياسات المصرح بها
  5242880, -- 5 MB كحد أقصى للملف الواحد
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. دالة مساعدة للتحقق من انتماء المستخدم لنفس المؤسسة المسجلة في مسار الملف
-- الهيكل المتوقع لمسار الملف: {organization_id}/{meter_id}/{filename}
CREATE OR REPLACE FUNCTION storage.user_belongs_to_org_path(storage_path text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  path_org_id uuid;
  user_org_id uuid;
BEGIN
  -- استخراج organization_id من الجزء الأول من المسار
  BEGIN
    path_org_id := (string_to_array(storage_path, '/'))[1]::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  -- جلب organization_id الخاص بالمستخدم الحالي من جدول profiles
  SELECT organization_id INTO user_org_id
  FROM public.profiles
  WHERE id = auth.uid();

  IF user_org_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN path_org_id = user_org_id;
END;
$$;

-- 3. تفعيل RLS لجدول storage.objects (إن لم يكن مفعلاً)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 4. إزالة أي سياسات سابقة تعارض الـ Bucket لتجنب التكرار
DROP POLICY IF EXISTS "Meter readings storage upload policy" ON storage.objects;
DROP POLICY IF EXISTS "Meter readings storage read policy" ON storage.objects;
DROP POLICY IF EXISTS "Meter readings storage update policy" ON storage.objects;
DROP POLICY IF EXISTS "Meter readings storage delete policy" ON storage.objects;

-- 5. سياسة السماح بالرفع (INSERT): للمستخدمين المسجلين داخل مؤسستهم فقط
CREATE POLICY "Meter readings storage upload policy"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'meter-readings' AND
  storage.user_belongs_to_org_path(name)
);

-- 6. سياسة السماح بالقراءة (SELECT): للمستخدمين المسجلين داخل نفس المؤسسة فقط
CREATE POLICY "Meter readings storage read policy"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'meter-readings' AND
  storage.user_belongs_to_org_path(name)
);

-- 7. سياسة التحديث (UPDATE): التعديل للمصرح لهم داخل المؤسسة
CREATE POLICY "Meter readings storage update policy"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'meter-readings' AND
  storage.user_belongs_to_org_path(name)
);

-- 8. سياسة الحذف (DELETE): المشرفون والمستخدمون التابعون لنفس المؤسسة
CREATE POLICY "Meter readings storage delete policy"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'meter-readings' AND
  storage.user_belongs_to_org_path(name)
);
