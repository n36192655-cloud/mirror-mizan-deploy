import { supabase } from "./supabase";

/**
 * Device fingerprint (client-side, stable across sessions).
 * Uses navigator/screen/hardware signals + a persistent random salt in
 * localStorage so the same physical browser install always yields the
 * same fingerprint. Not privacy-invasive; used only to enforce the
 * per-user device cap defined by `tenants.max_devices`.
 */
export function computeDeviceFingerprint(): string {
  if (typeof window === "undefined") return "ssr";
  const KEY = "mizan-device-salt";
  let salt = "";
  try {
    salt = localStorage.getItem(KEY) ?? "";
    if (!salt) {
      salt =
        (crypto?.randomUUID?.() ??
          Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem(KEY, salt);
    }
  } catch {
    salt = "no-storage";
  }
  const parts = [
    salt,
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    String(navigator.hardwareConcurrency ?? ""),
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
  ].join("|");
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  for (let i = 0; i < parts.length; i++) {
    const c = parts.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761) >>> 0;
    h2 = Math.imul(h2 ^ c, 1597334677) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function deviceLabel(): string {
  if (typeof window === "undefined") return "server";
  const ua = navigator.userAgent;
  const os =
    /Android/i.test(ua) ? "Android"
    : /iPhone|iPad|iPod/i.test(ua) ? "iOS"
    : /Windows/i.test(ua) ? "Windows"
    : /Macintosh|Mac OS/i.test(ua) ? "macOS"
    : /Linux/i.test(ua) ? "Linux"
    : "Device";
  const browser =
    /Edg\//i.test(ua) ? "Edge"
    : /Chrome/i.test(ua) ? "Chrome"
    : /Firefox/i.test(ua) ? "Firefox"
    : /Safari/i.test(ua) ? "Safari"
    : "Browser";
  return `${os} · ${browser}`;
}

export interface RegisterDeviceResult {
  ok: boolean;
  reason?: "device_limit_exceeded" | "not_authenticated" | "no_tenant" | "unknown";
  message?: string;
}

/**
 * Registers or refreshes this device's slot server-side. Enforces the
 * per-user device cap from the RPC. Signs the user out on cap breach.
 */
export async function registerCurrentDevice(): Promise<RegisterDeviceResult> {
  if (typeof window === "undefined") return { ok: true };
  const fp = computeDeviceFingerprint();
  const label = deviceLabel();
  const { error } = await supabase.rpc("register_device_slot", {
    _device_fingerprint: fp,
    _device_label: label,
    _user_agent: navigator.userAgent.slice(0, 200),
  });
  if (!error) return { ok: true };
  const msg = error.message ?? "";
  if (msg.includes("device_limit_exceeded")) {
    return { ok: false, reason: "device_limit_exceeded", message: msg };
  }
  if (msg.includes("not authenticated")) return { ok: false, reason: "not_authenticated" };
  if (msg.includes("no tenant")) return { ok: false, reason: "no_tenant" };
  return { ok: false, reason: "unknown", message: msg };
}
