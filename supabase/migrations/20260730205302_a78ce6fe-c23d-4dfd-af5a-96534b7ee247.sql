-- Attach the (already existing) authoritative reading logic to the table.
DROP TRIGGER IF EXISTS trg_reading_before_insert ON public.water_readings;
CREATE TRIGGER trg_reading_before_insert
  BEFORE INSERT ON public.water_readings
  FOR EACH ROW EXECUTE FUNCTION public.tg_reading_before_insert();

DROP TRIGGER IF EXISTS trg_reading_after_write ON public.water_readings;
CREATE TRIGGER trg_reading_after_write
  AFTER INSERT OR UPDATE OF status ON public.water_readings
  FOR EACH ROW EXECUTE FUNCTION public.tg_reading_after_write();

DROP TRIGGER IF EXISTS trg_readings_touch ON public.water_readings;
CREATE TRIGGER trg_readings_touch
  BEFORE UPDATE ON public.water_readings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_bills_touch ON public.water_bills;
CREATE TRIGGER trg_bills_touch
  BEFORE UPDATE ON public.water_bills
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();