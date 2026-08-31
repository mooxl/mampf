import {
  getCookie,
  getRequestProtocol,
  setCookie,
  deleteCookie,
} from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { NotConfigured } from "../shared/api";

const COOKIE_NAME = "mampf_session";
// Keep the family signed in on their devices, effectively forever.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The shared PIN as a typed Effect failure — a missing secret is a
 * recoverable, reportable condition, not a defect to crash a request with.
 * Set with `.dev.vars` locally and `wrangler secret put PIN` in production.
 */
const pin: Effect.Effect<string, NotConfigured> = Effect.gen(function* () {
  const value = (env as { PIN?: string }).PIN;
  if (!value) {
    return yield* new NotConfigured({
      message: "PIN is not configured. Set the PIN secret in your environment.",
    });
  }
  return value;
});

/** Stateless session token: a salted hash of the PIN, stored in a cookie. */
const sessionToken: Effect.Effect<string, NotConfigured> = Effect.gen(function* () {
  const value = yield* pin;
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mampf:${value}`)),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
});

export const sessionValid: Effect.Effect<boolean, NotConfigured> = Effect.gen(function* () {
  return (yield* sessionToken) === getCookie(COOKIE_NAME);
});

export const establishSession = (
  userPin: string,
): Effect.Effect<boolean, NotConfigured> =>
  Effect.gen(function* () {
    if (userPin !== (yield* pin)) return false;
    const token = yield* sessionToken;
    yield* Effect.sync(() =>
      setCookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        // The app runs behind HTTPS in production; local dev is plain HTTP.
        secure: getRequestProtocol() === "https",
        path: "/",
        maxAge: COOKIE_MAX_AGE,
      }),
    );
    return true;
  });

export const clearSession: Effect.Effect<void> = Effect.sync(() =>
  deleteCookie(COOKIE_NAME, { path: "/" }),
);
