import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { managerResetSubordinatePassword } from "@/lib/tenant-admin.functions";
import { toast } from "sonner";
import { KeyRound, RefreshCw, Users as UsersIcon } from "lucide-react";

export const Route = createFileRoute("/users")({
  head: () => ({ meta: [{ title: "إدارة المستخدمين — ميزان" }] }),
  component: UsersPage,
});

type SubRole = "manager" | "collector" | "reader";
interface Row {
  id: string;
  display_name: string | null;
  email: string | null;
  must_change_password: boolean;
  role: SubRole;
}

const ROLE_LABEL: Record<SubRole, string> = {
  manager: "مدير المشروع",
  collector: "محصل",
  reader: "قارئ عدادات",
};

function UsersPage() {
  const { user } = useAuth();
  const resetPwd = useServerFn(managerResetSubordinatePassword);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const { data: profiles, error: pe } = await supabase
      .from("profiles")
      .select("id, display_name, email, must_change_password")
      .eq("tenant_id", user.tenantId);
    if (pe) {
      toast.error("تعذّر جلب المستخدمين");
      setLoading(false);
      return;
    }
    const ids = (profiles ?? []).map((p) => p.id);
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .eq("tenant_id", user.tenantId)
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const roleByUser = new Map<string, SubRole>();
    (roles ?? []).forEach((r) => {
      if (r.role === "manager" || r.role === "collector" || r.role === "reader") {
        roleByUser.set(r.user_id, r.role);
      }
    });
    setRows(
      (profiles ?? [])
        .map((p) => ({
          id: p.id,
          display_name: p.display_name,
          email: p.email,
          must_change_password: !!p.must_change_password,
          role: roleByUser.get(p.id) ?? ("reader" as SubRole),
        }))
        .filter((r) => roleByUser.has(r.id))
        .sort((a, b) => a.role.localeCompare(b.role)),
    );
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UsersIcon className="w-6 h-6 text-primary" /> إدارة المستخدمين
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {"مشروع المياه"}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ml-2 ${loading ? "animate-spin" : ""}`} /> تحديث
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الحسابات ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">
              لا يوجد مستخدمون بعد.
            </p>
          )}
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <div className="font-semibold truncate">{r.display_name ?? "—"}</div>
                <div className="text-xs text-muted-foreground truncate" dir="ltr">
                  {r.email ?? "—"}
                </div>
                {r.must_change_password && (
                  <Badge variant="destructive" className="mt-1">
                    كلمة مرور مؤقتة
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{ROLE_LABEL[r.role]}</Badge>
                {r.role !== "manager" && r.id !== user?.userId && (
                  <ResetPasswordDialog
                    row={r}
                    onReset={async (pwd) => {
                      try {
                        await resetPwd({ data: { subordinateUserId: r.id, newPassword: pwd } });
                        toast.success("تم إعادة تعيين كلمة المرور");
                        void refresh();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "فشل إعادة التعيين");
                      }
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ResetPasswordDialog({
  row,
  onReset,
}: {
  row: Row;
  onReset: (pwd: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <KeyRound className="w-4 h-4 ml-1" /> إعادة تعيين
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>إعادة تعيين كلمة مرور {row.display_name ?? row.email}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            يتم استبدال كلمة المرور فورًا. سيُطلب من المستخدم تغييرها عند الدخول التالي.
          </p>
          <Input
            type="text"
            placeholder="كلمة المرور المؤقتة (6 أحرف على الأقل)"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            إلغاء
          </Button>
          <Button
            disabled={busy || pwd.length < 6}
            onClick={async () => {
              setBusy(true);
              await onReset(pwd);
              setBusy(false);
              setPwd("");
              setOpen(false);
            }}
          >
            تأكيد
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
