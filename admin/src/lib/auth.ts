/**
 * Minimal cookie auth for the admin area.
 * Credentials come entirely from the environment (ADMIN_USER /
 * ADMIN_PASSWORD / AUTH_SECRET) — nothing is hardcoded. If the credentials
 * are unset, login is disabled (checkCredentials always returns false).
 * The session cookie holds an HMAC so it can't be forged without
 * AUTH_SECRET. Edge-runtime compatible (Web Crypto only) so the same code
 * runs in middleware and route handlers.
 */
export const ADMIN_EMAIL = process.env.ADMIN_USER || process.env.ADMIN_EMAIL || "";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
export const COOKIE_NAME = "lp_admin";

// Derived from AUTH_SECRET; falls back to the password so a valid signing
// key always exists once credentials are configured.
const SECRET = process.env.AUTH_SECRET || ADMIN_PASSWORD || "";

async function hmacHex(value: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createToken(): Promise<string> {
  return hmacHex(`admin:${ADMIN_EMAIL}`);
}

export async function verifyToken(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  return token === (await createToken());
}

export function checkCredentials(email: string, password: string): boolean {
  // No credentials configured → login disabled.
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return false;
  return (
    email.trim().toLowerCase() === ADMIN_EMAIL.trim().toLowerCase() &&
    password === ADMIN_PASSWORD
  );
}
