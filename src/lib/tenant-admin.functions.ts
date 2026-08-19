import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";



/**
 * Project Manager only: override a subordinate (collector/reader) password
 * inside the same tenant. Forces `must_change_password` on next login.
 * No email verification — designed for offline field recovery.
 */
export const managerResetSubordinatePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        subordinateUserId: z.string().uuid(),
        newPassword: z.string().min(6).max(72),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    // Caller must be a manager. Find their tenant via profile.
    const { data: prof, error: pErr } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (pErr || !prof?.tenant_id) throw new Error("forbidden: no tenant profile");

    const { data: mgr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("tenant_id", prof.tenant_id)
      .eq("role", "manager")
      .maybeSingle();
    if (!mgr) throw new Error("forbidden: manager role required");

    // Subordinate must belong to the SAME tenant and have a subordinate role.
    const { data: subRoles, error: sErr } = await context.supabase
      .from("user_roles")
      .select("role, tenant_id")
      .eq("user_id", data.subordinateUserId);
    if (sErr) throw new Error(sErr.message);
    const inTenant = (subRoles ?? []).some(
      (r) => r.tenant_id === prof.tenant_id && (r.role === "collector" || r.role === "reader"),
    );
    if (!inTenant) throw new Error("forbidden: subordinate not in your project");
    if (data.subordinateUserId === context.userId) throw new Error("cannot reset your own password here");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(data.subordinateUserId, {
      password: data.newPassword,
    });
    if (updErr) throw new Error(updErr.message);

    await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", data.subordinateUserId);

    return { ok: true };
  });

/**
 * Any signed-in user: update their own password.
 * Clears the `must_change_password` flag on success.
 */
export const updateOwnPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ newPassword: z.string().min(6).max(72) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);
    await context.supabase
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", context.userId);
    return { ok: true };
  });
