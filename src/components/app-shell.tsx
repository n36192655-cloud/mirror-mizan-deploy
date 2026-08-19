import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Users, ClipboardList, Receipt, Wallet, Droplets, LogOut, TrendingDown, Scale, UserCog, User, Layers } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useAuth, useAuthHydrated, ROLE_LABEL, canAccess, defaultRouteFor, type Role } from "@/lib/auth";
import { NetworkStatus } from "./network-status";
import { CopyrightFooter } from "./footer";
import { syncPending, useOnlineStatus } from "@/lib/sync";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";


type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; roles: Role[] };

const NAV: NavItem[] = [
  { to: "/", label: "لوحة التحكم", icon: LayoutDashboard, roles: ["super_admin", "manager"] },
  { to: "/customers", label: "المشتركون", icon: Users, roles: ["super_admin", "manager"] },
  { to: "/readings", label: "القراءات", icon: ClipboardList, roles: ["super_admin", "manager", "reader"] },
  { to: "/bills", label: "الفواتير", icon: Receipt, roles: ["super_admin", "manager", "collector"] },
  { to: "/payments", label: "التحصيل", icon: Wallet, roles: ["super_admin", "manager", "collector"] },
  { to: "/tariffs", label: "التعرفة الشرائحية", icon: Layers, roles: ["super_admin", "manager"] },
  { to: "/loss-analysis", label: "تحليل الفاقد", icon: TrendingDown, roles: ["super_admin", "manager"] },
  { to: "/users", label: "المستخدمون", icon: UserCog, roles: ["super_admin", "manager"] },
  { to: "/assistant", label: "ميزان الذكي", icon: Scale, roles: ["super_admin", "manager"] },
  { to: "/profile", label: "حسابي", icon: User, roles: ["super_admin", "manager", "reader", "collector"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const authHydrated = useAuthHydrated();
  const online = useOnlineStatus();

  // لا يوجد تغيير كلمة مرور إجباري — الدخول أصبح باختيار الدور بنقرة واحدة.


  // Route protection — لا تُطبَّق قبل استعادة الجلسة من التخزين المحلي.
  useEffect(() => {
    if (!authHydrated) return;
    if (pathname === "/login") return;
    if (!user) { navigate({ to: "/login", replace: true }); return; }
    if (!canAccess(user.role, pathname)) {
      navigate({ to: defaultRouteFor(user.role), replace: true });
    }
  }, [pathname, user, navigate, authHydrated]);


  // Auto-sync when coming online
  useEffect(() => {
    if (online) syncPending();
  }, [online]);

  // مزامنة حيّة بين الحسابات الثلاثة (مدير / قارئ / محصل)
  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void useStore.getState().hydrateFromSupabase(); }, 400);
    };
    void useStore.getState().hydrateFromSupabase();
    const channel = supabase
      .channel("mizan-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "water_readings" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "water_bills" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, refresh)
      .subscribe();
    const poll = setInterval(() => { if (navigator.onLine) refresh(); }, 60000);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [user]);


  const isPublic = pathname === "/login" || pathname === "/reset-password";
  if (isPublic) return <>{children}</>;
  if (!user) return null;
  if (!canAccess(user.role, pathname)) return null;

  const nav = NAV.filter((n) => n.roles.includes(user.role));


  return (
    <div className="min-h-screen flex w-full bg-background text-foreground">
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground border-l border-sidebar-border">
        <div className="px-5 py-6 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="relative w-9 h-9 rounded-xl grid place-items-center" style={{ background: "linear-gradient(135deg, var(--water) 0%, #0ea5e9 100%)" }}>
              <Droplets className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight">MIZAN AI</div>
              <div className="text-[11px] text-sidebar-foreground/60">محرك الذكاء لاستدامة المياه (WSIE)</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map((item) => {
            const active = pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to));
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-primary font-semibold"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="px-4 py-4 border-t border-sidebar-border space-y-2">
          <div className="text-xs">
            <div className="font-semibold text-sidebar-foreground">{user.name}</div>
            <div className="text-sidebar-foreground/60">{ROLE_LABEL[user.role]}</div>
          </div>
          <button
            onClick={async () => { await logout(); navigate({ to: "/login", replace: true }); }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
          >
            <LogOut className="w-3 h-3" /> تسجيل الخروج
          </button>
          <div className="text-[10px] text-sidebar-foreground/50 pt-2 border-t border-sidebar-border/60">تعز — اليمن · إصدار 2.0</div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-card border-b px-4 py-2 flex items-center justify-between gap-2">
          <div className="md:hidden font-bold">ميزان</div>
          <div className="hidden md:block text-xs text-muted-foreground">
            {`${ROLE_LABEL[user.role]} — ${user.name}`}
          </div>
          <NetworkStatus />
        </header>
        <main className="flex-1 p-4 md:p-8 max-w-[1400px] w-full mx-auto">{children}</main>
        <CopyrightFooter className="border-t" />
        <nav className="md:hidden sticky bottom-0 grid bg-sidebar text-sidebar-foreground border-t border-sidebar-border" style={{ gridTemplateColumns: `repeat(${nav.length + 1}, minmax(0,1fr))` }}>
          {nav.map((item) => {
            const active = pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to));
            const Icon = item.icon;
            return (
              <Link key={item.to} to={item.to} className={cn("flex flex-col items-center gap-1 py-2 text-[10px]", active ? "text-sidebar-primary" : "text-sidebar-foreground/70")}>
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <button onClick={() => { logout(); navigate({ to: "/login", replace: true }); }} className="flex flex-col items-center gap-1 py-2 text-[10px] text-sidebar-foreground/70">
            <LogOut className="w-4 h-4" />
            <span>خروج</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
