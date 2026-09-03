import { env } from "cloudflare:workers";

type Role = "staff" | "admin";
const COOKIE_NAMES: Record<Role, string> = { staff: "festival_staff_session", admin: "festival_admin_session" };
const SESSION_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

function database() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

function secrets() {
  const runtime = env as unknown as Record<string, unknown>;
  const staffPin = typeof runtime.STAFF_PIN === "string" ? runtime.STAFF_PIN : "";
  const adminPin = typeof runtime.ADMIN_PIN === "string" ? runtime.ADMIN_PIN : "";
  const sessionSecret = typeof runtime.STAFF_SESSION_SECRET === "string" ? runtime.STAFF_SESSION_SECRET : "";
  if (!staffPin || !sessionSecret) throw new Error("スタッフ認証の設定がありません");
  return { staffPin, adminPin, sessionSecret };
}

function safeEqual(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

function toBase64Url(value: string) {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
}

async function signature(payload: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return toBase64Url(binary);
}

function cookieValue(request: Request, role: Role) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAMES[role]) return rest.join("=");
  }
  return null;
}

async function readSession(request: Request, role: Role) {
  try {
    const token = cookieValue(request, role);
    if (!token) return null;
    const [payload, receivedSignature] = token.split(".");
    if (!payload || !receivedSignature) return null;
    const { sessionSecret } = secrets();
    const expectedSignature = await signature(payload, sessionSecret);
    if (!safeEqual(receivedSignature, expectedSignature)) return null;
    const data = JSON.parse(fromBase64Url(payload)) as { sessionId?: string; role?: Role; expiresAt?: number };
    if (!data.sessionId || data.role !== role || typeof data.expiresAt !== "number" || data.expiresAt <= Date.now()) return null;
    const row = await database().prepare("SELECT id, expires_at, last_seen_at, revoked_at FROM auth_sessions WHERE id = ? AND role = ?").bind(data.sessionId, role).first<{ id: string; expires_at: number; last_seen_at: number; revoked_at: number | null }>();
    if (!row || row.revoked_at != null || row.expires_at <= Date.now()) return null;
    const now = Date.now();
    if (row.last_seen_at < now - 60_000) await database().prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?").bind(now, row.id).run();
    return { id: row.id, role };
  } catch {
    return null;
  }
}

export async function verifyStaffSession(request: Request) { return (await readSession(request, "staff")) != null; }
export async function verifyAdminSession(request: Request) { return (await readSession(request, "admin")) != null; }
export async function currentSessionId(request: Request, role: Role) { return (await readSession(request, role))?.id ?? null; }

export function verifyStaffPin(pin: string) { return safeEqual(pin, secrets().staffPin); }
export function verifyAdminPin(pin: string) {
  const { adminPin } = secrets();
  if (!adminPin) throw new Error("管理者認証の設定がありません");
  return safeEqual(pin, adminPin);
}

function normalizedLabel(label: string | undefined, role: Role) {
  const trimmed = label?.trim().slice(0, 40);
  return trimmed || (role === "admin" ? "管理者端末" : "受付端末");
}

async function sessionCookie(role: Role, deviceLabel?: string, userAgent?: string) {
  const now = Date.now();
  const expiresAt = now + SESSION_SECONDS * 1000;
  const sessionId = crypto.randomUUID();
  await database().prepare("INSERT INTO auth_sessions (id, role, device_label, user_agent, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
    sessionId, role, normalizedLabel(deviceLabel, role), userAgent?.slice(0, 300) ?? null, now, expiresAt, now,
  ).run();
  const { sessionSecret } = secrets();
  const payload = toBase64Url(JSON.stringify({ sessionId, role, expiresAt }));
  const token = `${payload}.${await signature(payload, sessionSecret)}`;
  return `${COOKIE_NAMES[role]}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export function staffSessionCookie(deviceLabel?: string, userAgent?: string) { return sessionCookie("staff", deviceLabel, userAgent); }
export function adminSessionCookie(deviceLabel?: string, userAgent?: string) { return sessionCookie("admin", deviceLabel, userAgent); }

export async function revokeCurrentSession(request: Request, role: Role) {
  const session = await readSession(request, role);
  if (session) await database().prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ?").bind(Date.now(), session.id).run();
}

export function clearStaffSessionCookie() { return `${COOKIE_NAMES.staff}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }
export function clearAdminSessionCookie() { return `${COOKIE_NAMES.admin}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }
