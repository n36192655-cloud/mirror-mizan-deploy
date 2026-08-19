import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { supabase } from "./supabase";
import { useStore } from "./store";
import { registerCurrentDevice } from "./device-session";

// Role IDs mirror the database `app_role` enum exactly.
export type Role = "super_admin" | "manager" | "reader" | "collector";

export interface AuthUser {
  name: string;
  role: Role;
  userId: string;
  tenantId?: string;
  mustChangePassword?: boolean;
  email?: string;
  username?: string;
}

export type LoginErrorCode =
  | "bad_credentials"
  | "device_limit_exceeded"
  | null;

interface AuthState {
  user: AuthUser | null;
  loginError: LoginErrorCode;
  /** Sign in by username (regular users) or e-mail (super_admin). */
  loginWithIdentifier: (identifier: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  hydrateFromSupabase: () => Promise<void>;
  markPasswordChanged: () => void;
}

async function resolveEmailForIdentifier(identifier: string): Promise<string | null> {
  const id = identifier.trim();
  if (!id) return null;
  if (id.includes("@")) return id;
  const { data, error } = await supabase.rpc("email_for_username", {
    _username: id,
  });
  if (error || !data) return null;
  return typeof data === "string" ? data : null;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      loginError: null,

      loginWithIdentifier: async (identifier, password) => {
        const email = await resolveEmailForIdentifier(identifier);
        if (!email) {
          set({ loginError: "bad_credentials" });
          return false;
        }
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error || !data.user) {
          set({ loginError: "bad_credentials" });
          return false;
        }
        const dev = await registerCurrentDevice();
        if (!dev.ok && dev.reason === "device_limit_exceeded") {
          await supabase.auth.signOut();
          set({ loginError: "device_limit_exceeded", user: null });
          return false;
        }
        await useAuth.getState().hydrateFromSupabase();
        return true;
      },

      hydrateFromSupabase: async () => {
        const { data: userData } = await supabase.auth.getUser();
        const authUser = userData.user;
        if (!authUser) {
          set({ user: null });
          return;
        }
        const { data: profile } = await supabase
          .from("profiles")
          .select("tenant_id, display_name, must_change_password, email, username")
          .eq("id", authUser.id)
          .maybeSingle();

        const { data: roles } = await supabase
          .from("user_roles")
          .select("role, tenant_id")
          .eq("user_id", authUser.id);

        const tenantRole = (roles ?? []).find(
          (r) => r.tenant_id && r.tenant_id === profile?.tenant_id,
        )?.role;

        const anyRole = (roles ?? [])[0]?.role;
        const effective = tenantRole ?? anyRole;
        let role: Role = "manager";
        if (effective === "reader") role = "reader";
        else if (effective === "collector") role = "collector";
        else if (effective === "super_admin") role = "super_admin";
        else if (effective === "manager") role = "manager";

        set({
          user: {
            name: profile?.display_name ?? authUser.email ?? "مستخدم",
            email: profile?.email ?? authUser.email ?? undefined,
            username: profile?.username ?? undefined,
            role,
            userId: authUser.id,
            tenantId: profile?.tenant_id ?? undefined,
            mustChangePassword: profile?.must_change_password ?? false,
          },
          loginError: null,
        });

        void registerCurrentDevice().catch(() => {});
        void useStore.getState().hydrateFromSupabase();
      },

      markPasswordChanged: () => {
        const cur = useAuth.getState().user;
        if (cur) set({ user: { ...cur, mustChangePassword: false } });
      },

      logout: async () => {
        await supabase.auth.signOut();
        // امسح بيانات المشتركين المخزّنة محليًا حتى لا يرى المستخدم التالي
        // بيانات جلسة سابقة قبل اكتمال المزامنة.
        useStore.getState().reset();
        set({ user: null });
      },

    }),
    { name: "mizan-auth-v4" },
  ),
);

/**
 * هل انتهت استعادة جلسة المستخدم من التخزين المحلي؟
 * حراسة المسارات يجب ألا تعمل قبل ذلك، وإلا يُطرد المستخدم من الصفحة
 * الحالية (مثل «المشتركون») عند تحديث المتصفح.
 */
export function useAuthHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const p = (useAuth as unknown as { persist?: {
      hasHydrated: () => boolean;
      onFinishHydration: (cb: () => void) => () => void;
    } }).persist;
    if (!p || p.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return p.onFinishHydration(() => setHydrated(true));
  }, []);
  return hydrated;
}




export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "مشرف عام",
  manager: "مدير مشروع",
  reader: "قارئ عدادات",
  collector: "محصل",
};

export function canAccess(role: Role | undefined, path: string): boolean {
  if (!role) return false;
  if (path === "/profile") return true;
  if (role === "super_admin" || role === "manager") return true;
  if (role === "reader") return path === "/readings";
  if (role === "collector") return path === "/bills" || path === "/payments";
  return false;
}


export function defaultRouteFor(role: Role): string {
  if (role === "reader") return "/readings";
  if (role === "collector") return "/bills";
  return "/";
}
