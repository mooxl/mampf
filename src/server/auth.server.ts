import {
  getCookie,
  getRequestProtocol,
  setCookie,
  deleteCookie,
} from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

const COOKIE_NAME = "mampf_session";
// Keep the family signed in on their devices, effectively forever.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The shared PIN. Set with `.dev.vars` locally and `wrangler secret put PIN` in production. */
function pin(): string {
  const value = (env as { PIN?: string }).PIN;
  if (!value) {
    throw new Error("PIN is not configured. Set the PIN secret in your environment.");
  }
  return value;
}

/** Stateless session token: a salted hash of the PIN, stored in a cookie. */
async function sessionToken(): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mampf:${pin()}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sessionValid(): Promise<boolean> {
  return (await sessionToken()) === getCookie(COOKIE_NAME);
}

export async function establishSession(userPin: string): Promise<boolean> {
  if (userPin !== pin()) return false;
  setCookie(COOKIE_NAME, await sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    // The app runs behind HTTPS in production; local dev is plain HTTP.
    secure: getRequestProtocol() === "https",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return true;
}

export function clearSession(): void {
  deleteCookie(COOKIE_NAME, { path: "/" });
}
