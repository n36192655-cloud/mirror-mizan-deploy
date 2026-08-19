import { useOnlineStatus, usePendingCount, syncPending } from "@/lib/sync";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useState } from "react";

export function NetworkStatus() {
  const online = useOnlineStatus();
  const pending = usePendingCount();
  const [syncing, setSyncing] = useState(false);

  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
          online ? "bg-emerald-500/15 text-emerald-600" : "bg-destructive/15 text-destructive font-semibold animate-pulse"
        }`}
      >
        {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
        {online ? "متصل بالشبكة" : "وضع الأوفلاين"}
      </span>
      
      {pending > 0 && (
        <>
          <span className="text-muted-foreground bg-amber-500/10 px-2 py-1 rounded-md border border-amber-500/20 text-amber-700">
            قراءات معلقة بالهاتف: <b className="font-mono">{pending}</b>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 border-primary/30 text-primary hover:bg-primary/5"
            disabled={!online || syncing}
            onClick={() => {
              setSyncing(true);
              toast.loading("جاري ترحيل ومزامنة القراءات الميدانية...", { id: "sync-toast" });
              
              // عمل تأخير بسيط لإعطاء تجربة بصرية ممتازة أثناء الرفع
              setTimeout(() => {
                void syncPending()
                  .then(({ synced }) => {
                    if (synced > 0) {
                      toast.success(`تم بنجاح ترحيل ومزامنة ${synced} قراءة إلى السيرفر الرئيسي!`, { id: "sync-toast" });
                    } else {
                      toast.info("لا توجد قراءات صالحة للمزامنة حالياً", { id: "sync-toast" });
                    }
                  })
                  .catch(() => {
                    toast.error("فشلت المزامنة التلقائية، يرجى التحقق من جودة الإشارة", { id: "sync-toast" });
                  })
                  .finally(() => setSyncing(false));
              }, 1200);
            }}
          >
            <RefreshCw className={`w-3 h-3 ms-1 ${syncing ? "animate-spin" : ""}`} /> 
            {syncing ? "جاري الرفع..." : "مزامنة الآن"}
          </Button>
        </>
      )}
    </div>
  );
}
