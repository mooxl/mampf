import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { NotConfigured } from "../shared/api";

export const COOKIE_NAME = "mampf_session";
// Keep the family signed in on their devices, effectively forever.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The shared PIN: `.dev.vars` locally, `wrangler secret put PIN` in production.
 * A missing secret is a reportable failure, not a defect.
 */
const pin = Effect.gen(function* () {
  const value = (env as { PIN?: string }).PIN;
  if (!value) {
    return yield* new NotConfigured({
      message: "PIN is not configured. Set the PIN secret in your environment.",
    });
  }
  return value;
});

/** Stateless session token: a salted hash of the PIN, stored in a cookie. */
const sessionToken = Effect.gen(function* () {
  const value = yield* pin;
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mampf:${value}`)),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
});

/** True when `cookieValue` is the session token. With no PIN configured nobody is signed in. */
export const sessionTokenMatches = (cookieValue: string | undefined): Effect.Effect<boolean> =>
  sessionToken.pipe(
    Effect.map((token) => cookieValue !== undefined && cookieValue === token),
    Effect.catch(() => Effect.succeed(false)),
  );

/** Register a `Set-Cookie` for the session on the eventual RPC response. */
const setSessionCookie = (value: string, maxAge: number) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    // The app runs behind HTTPS in production; local dev is plain HTTP.
    const secure = (request.headers["x-forwarded-proto"] ?? request.url.split(":")[0]) === "https";
    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.orDie(
        HttpServerResponse.setCookie(response, COOKIE_NAME, value, {
          httpOnly: true,
          sameSite: "lax",
          secure,
          path: "/",
          maxAge,
        }),
      ),
    );
  });

/** Establish a session if the PIN matches; `false` (and no cookie) on a wrong PIN. */
export const establishSession = Effect.fn("establishSession")(function* (userPin: string) {
  if (userPin !== (yield* pin)) return false;
  yield* setSessionCookie(yield* sessionToken, COOKIE_MAX_AGE);
  return true;
});

export const clearSession = setSessionCookie("", 0);
