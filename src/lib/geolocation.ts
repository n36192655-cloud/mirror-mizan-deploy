export interface GeoFix {
  lat: number;
  lng: number;
  accuracy: number;
}

export function getGeoFix(timeoutMs = 15000): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("الموقع الجغرافي (GPS) غير مدعوم في هذا الجهاز أو المتصفح"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        // هندسة أخطاء الـ GPS وترجمتها ميدانياً لمساعدة القارئ
        let errorMsg = "تعذّر قراءة الموقع الجغرافي";
        if (err.code === err.PERMISSION_DENIED) {
          errorMsg = "الرجاء تفعيل صلاحية الموقع (GPS) للمتصفح والتطبيق";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          errorMsg = "إشارة الـ GPS ضعيفة حالياً، يرجى الانتقال لمكان مكشوف";
        } else if (err.code === err.TIMEOUT) {
          errorMsg = "انتهت مهلة البحث عن الأقمار الصناعية، أعد المحاولة خلال ثوانٍ";
        }
        reject(new Error(errorMsg));
      },
      { 
        enableHighAccuracy: true, // إجبار استخدام حساس الهاردوير الميداني
        timeout: timeoutMs,       // زيادة المهلة إلى 15 ثانية لضمان اللقطة في وضع الأوفلاين
        maximumAge: 60000         // السماح بقبول قراءة دقيقة مجهزة مسبقاً خلال آخر دقيقة لتسريع الأداء
      }
    );
  });
}
