import React, { useRef, useState, useCallback, useEffect } from "react";
import { Camera, RefreshCw, Upload, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface MeterCameraProps {
  onCapture: (imageFile: File, previewUrl: string) => void;
  onClear?: () => void;
  initialPreview?: string;
}

/**
 * دالة مساعدة لضغط الصور والحفاظ على وضوح أرقام العداد
 * - الحد الأقصى للأبعاد: 1600x1200
 * - الجودة: JPEG 0.82
 * - الناتج: File حقيقي جاهز للرفع السحابي إلى Supabase Storage Bucket (meter-readings)
 */
const compressImage = (
  source: HTMLVideoElement | HTMLImageElement,
  width: number,
  height: number
): Promise<{ file: File; previewUrl: string }> => {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    const MAX_WIDTH = 1600;
    const MAX_HEIGHT = 1200;

    let targetWidth = width;
    let targetHeight = height;

    if (targetWidth > MAX_WIDTH || targetHeight > MAX_HEIGHT) {
      if (targetWidth / targetHeight > MAX_WIDTH / MAX_HEIGHT) {
        targetHeight = Math.round((targetHeight * MAX_WIDTH) / targetWidth);
        targetWidth = MAX_WIDTH;
      } else {
        targetWidth = Math.round((targetWidth * MAX_HEIGHT) / targetHeight);
        targetHeight = MAX_HEIGHT;
      }
    }

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("تعذر إنشاء سياق الرسم للضغط"));
      return;
    }

    // تنعيم الصورة وحفظ حواف أرقام العداد بدقة عالية
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          const fileName = `meter_${Date.now()}.jpg`;
          const compressedFile = new File([blob], fileName, {
            type: "image/jpeg",
            lastModified: Date.now(),
          });
          const previewUrl = URL.createObjectURL(compressedFile);
          resolve({ file: compressedFile, previewUrl });
        } else {
          reject(new Error("فشل تحويل الصورة إلى Blob"));
        }
      },
      "image/jpeg",
      0.82
    );
  });
};

export const MeterCamera: React.FC<MeterCameraProps> = ({
  onCapture,
  onClear,
  initialPreview,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialPreview || null);
  const [error, setError] = useState<string | null>(null);
  const [isCompressing, setIsCompressing] = useState<boolean>(false);

  // إيقاف بث الكاميرا وتفريغ الموارد
  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }, []);

  // تنظيف روابط ObjectURL لمنع تسريب الذاكرة
  const cleanupPreview = useCallback(() => {
    if (previewUrl && previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      stopCamera();
      cleanupPreview();
    };
  }, [stopCamera, cleanupPreview]);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsCameraActive(true);
      }
    } catch (err) {
      console.error("Camera access error:", err);
      setError("تعذر فتح الكاميرا الميدانية. يرجى التأكد من صلاحيات الكاميرا أو استخدام صورة من المعرض.");
    }
  };

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current) return;
    setIsCompressing(true);
    setError(null);

    try {
      const video = videoRef.current;
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;

      const { file, previewUrl: newPreview } = await compressImage(video, width, height);

      cleanupPreview();
      setPreviewUrl(newPreview);
      stopCamera();
      onCapture(file, newPreview);
    } catch (err: any) {
      console.error("Error capturing meter photo:", err);
      setError("حدث خطأ أثناء التقاط وضغط صورة العداد.");
    } finally {
      setIsCompressing(false);
    }
  }, [stopCamera, onCapture, cleanupPreview]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // حماية مؤكدة من اختيار ملفات غير الصور
    if (!selectedFile.type.startsWith("image/")) {
      setError("يرجى اختيار ملف صورة صالح (JPG, PNG, WEBP).");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsCompressing(true);
    setError(null);

    const img = new Image();
    const objectUrl = URL.createObjectURL(selectedFile);

    img.onload = async () => {
      try {
        const { file, previewUrl: newPreview } = await compressImage(
          img,
          img.naturalWidth || 1280,
          img.naturalHeight || 720
        );
        URL.revokeObjectURL(objectUrl);

        cleanupPreview();
        setPreviewUrl(newPreview);
        stopCamera();
        onCapture(file, newPreview);
      } catch (err: any) {
        console.error("Error compressing gallery image:", err);
        setError("تعذر معالجة وضغط الصورة المختارة.");
      } finally {
        setIsCompressing(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setIsCompressing(false);
      setError("تعذر تحميل ملف الصورة المحدد. يرجى اختيار ملف صورة آخر.");
      if (fileInputRef.current) fileInputRef.current.value = "";
    };

    img.src = objectUrl;
  };

  const handleReset = () => {
    cleanupPreview();
    setPreviewUrl(null);
    setError(null);
    if (onClear) onClear();
  };

  return (
    <div className="flex flex-col items-center justify-center w-full gap-4 p-4 border rounded-xl bg-card shadow-sm dir-rtl">
      {error && (
        <Alert variant="destructive" className="w-full text-right dir-rtl">
          <AlertCircle className="w-4 h-4 ml-2" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!previewUrl && !isCameraActive && (
        <div className="flex flex-col sm:flex-row gap-3 w-full justify-center">
          <Button
            type="button"
            onClick={startCamera}
            disabled={isCompressing}
            className="gap-2 bg-primary text-primary-foreground"
          >
            <Camera className="w-4 h-4" />
            فتح الكاميرا للالتقاط
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isCompressing}
            onClick={() => fileInputRef.current?.click()}
            className="gap-2"
          >
            <Upload className="w-4 h-4" />
            اختيار صورة من المعرض
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/jpg"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>
      )}

      {isCameraActive && (
        <div className="relative w-full max-w-md overflow-hidden rounded-lg bg-black aspect-video flex items-center justify-center">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          <div className="absolute bottom-4 flex gap-4">
            <Button
              type="button"
              onClick={capturePhoto}
              disabled={isCompressing}
              variant="default"
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Check className="w-4 h-4" />
              {isCompressing ? "جاري الضغط..." : "التقاط القراءة"}
            </Button>
            <Button
              type="button"
              onClick={stopCamera}
              disabled={isCompressing}
              variant="destructive"
            >
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {previewUrl && (
        <div className="flex flex-col items-center gap-3 w-full max-w-md">
          <div className="relative w-full aspect-video rounded-lg overflow-hidden border">
            <img src={previewUrl} alt="معاينة صورة العداد" className="w-full h-full object-cover" />
          </div>
          <Button
            type="button"
            onClick={handleReset}
            variant="outline"
            className="gap-2 text-destructive border-destructive hover:bg-destructive/10"
          >
            <RefreshCw className="w-4 h-4" />
            إعادة التقاط الصورة
          </Button>
        </div>
      )}
    </div>
  );
};
