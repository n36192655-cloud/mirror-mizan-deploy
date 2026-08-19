import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth, defaultRouteFor } from "@/lib/auth";
import { updateOwnPassword } from "@/lib/tenant-admin.functions";
import { toast } from "sonner";
import { KeyRound, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "الملف الشخصي — ميزان" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const navigate = useNavigate();
  const { user, markPasswordChanged } = useAuth();
  const updatePwd = useServerFn(updateOwnPassword);
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (p1.length < 6) return toast.error("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
    if (p1 !== p2) return toast.error("كلمتا المرور غير متطابقتين");
    setBusy(true);
    try {
      await updatePwd({ data: { newPassword: p1 } });
      markPasswordChanged();
      toast.success("تم تحديث كلمة المرور");
      setP1("");
      setP2("");
      navigate({ to: defaultRouteFor(user!.role), replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل تحديث كلمة المرور");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">الملف الشخصي</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {user.name} — {user.email}
        </p>
      </div>

      {user.mustChangePassword && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/40 bg-destructive/5 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 text-destructive" />
          <div>يجب تغيير كلمة المرور المؤقتة قبل استخدام النظام.</div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5" /> تغيير كلمة المرور
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div>
              <Label htmlFor="np">كلمة المرور الجديدة</Label>
              <Input id="np" type="password" value={p1} onChange={(e) => setP1(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="np2">تأكيد كلمة المرور</Label>
              <Input id="np2" type="password" value={p2} onChange={(e) => setP2(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy}>
              {busy ? "جارٍ الحفظ…" : "حفظ كلمة المرور"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
