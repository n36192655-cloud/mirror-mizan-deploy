import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth, defaultRouteFor, type Role } from "@/lib/auth";
import { CopyrightFooter } from "@/components/footer";
import { Droplets, Loader2, UserCog, ClipboardList, Wallet } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "الدخول — منصة ميزان لإدارة المياه" },
      {
        name: "description",
        content:
          "دخول سريع إلى منصة ميزان — اختر دورك: مدير مشروع، قارئ عدادات، أو محصل.",
      },
      { property: "og:title", content: "الدخول — منصة ميزان لإدارة المياه" },
      {
        property: "og:description",
        content: "دخول سريع بحساب المشروع (مدير / قارئ عدادات / محصل).",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

type QuickAccount = {
  key: Role;
  label: string;
  hint: string;
  username: string;
  password: string;
  icon: typeof UserCog;
};

const ACCOUNTS: QuickAccount[] = [
  {
    key: "manager",
    label: "مدير مشروع",
    hint: "إدارة كاملة للمشروع والتقارير والمستخدمين",
    username: "manager",
    password: "Manager#2026!",
    icon: UserCog,
  },
  {
    key: "reader",
    label: "قارئ عدادات",
    hint: "إدخال قراءات العدادات الميدانية",
    username: "reader",
    password: "Reader#2026!",
    icon: ClipboardList,
  },
  {
    key: "collector",
    label: "محصل",
    hint: "إصدار الفواتير وتحصيل المدفوعات",
    username: "collector",
    password: "Collector#2026!",
    icon: Wallet,
  },
];

function LoginPage() {
  const navigate = useNavigate();
  const { user, loginWithIdentifier, loginError } = useAuth();
  const [busyKey, setBusyKey] = useState<Role | null>(null);

  useEffect(() => {
    if (!user) return;
    navigate({ to: defaultRouteFor(user.role), replace: true });
  }, [user, navigate]);

  async function pickAccount(acc: QuickAccount) {
    if (busyKey) return;
    setBusyKey(acc.key);
    try {
      const ok = await loginWithIdentifier(acc.username, acc.password);
      if (!ok) {
        const msg =
          loginError === "device_limit_exceeded"
            ? "تم تجاوز الحد المسموح من الأجهزة لهذا الحساب"
            : "تعذر الدخول بهذا الحساب";
        toast.error(msg);
      } else {
        toast.success(`تم الدخول بحساب ${acc.label}`);
      }
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col bg-gradient-to-br from-background via-background to-muted"
      dir="rtl"
    >
      <div className="flex-1 grid place-items-center px-4 py-10">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader className="text-center">
            <div
              className="mx-auto w-14 h-14 rounded-2xl grid place-items-center mb-2"
              style={{ background: "linear-gradient(135deg, var(--water) 0%, #0ea5e9 100%)" }}
            >
              <Droplets className="w-7 h-7 text-white" />
            </div>
            <CardTitle className="text-2xl">منصة ميزان</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              اختر دورك للدخول المباشر إلى النظام
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {ACCOUNTS.map((acc) => {
                const Icon = acc.icon;
                const busy = busyKey === acc.key;
                const disabled = busyKey !== null;
                return (
                  <Button
                    key={acc.key}
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full h-auto justify-start gap-3 py-3 px-4"
                    onClick={() => pickAccount(acc)}
                    disabled={disabled}
                  >
                    <div
                      className="w-10 h-10 shrink-0 rounded-xl grid place-items-center text-white"
                      style={{ background: "linear-gradient(135deg, var(--water) 0%, #0ea5e9 100%)" }}
                    >
                      {busy ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Icon className="w-5 h-5" />
                      )}
                    </div>
                    <div className="text-start flex-1">
                      <div className="font-bold text-base">{acc.label}</div>
                      <div className="text-[11px] text-muted-foreground font-normal">
                        {acc.hint}
                      </div>
                    </div>
                  </Button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground text-center pt-4">
              الدخول مباشر ومزامنة البيانات بين الحسابات الثلاثة تلقائية.
            </p>
          </CardContent>
        </Card>
      </div>
      <CopyrightFooter />
    </div>
  );
}
