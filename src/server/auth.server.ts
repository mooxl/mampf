import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type * as HttpServerRequest_ from "effect/unstable/http/HttpServerRequest";
import { NotConfigured } from "../shared/api";

/** The current HTTP request service, provided by the RPC transport. */
type Request = HttpServerRequest_.HttpServerRequest;

export const COOKIE_NAME = "mampf_session";
// Keep the family signed in on their devices, effectively forever.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The shared PIN as a typed Effect failure — a missing secret is a
 * recoverable, reportable condition, not a defect to crash a request with.
 * Set with `.dev.vars` locally and `wrangler secret put PIN` in production.
 */
export const pin: Effect.Effect<string, NotConfigured> = Effect.gen(function* () {
  const value = (env as { PIN?: string }).PIN;
  if (!value) {
    return yield* new NotConfigured({
      message: "PIN is not configured. Set the PIN secret in your environment.",
    });
  }
  return value;
});

/** Stateless session token: a salted hash of the PIN, stored in a cookie. */
export const sessionToken: Effect.Effect<string, NotConfigured> = Effect.gen(function* () {
  const value = yield* pin;
  const digest = yield* Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(`mampf:${value}`)),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
});

/**
 * True when `cookieValue` matches the expected session token. With no PIN
 * configured nobody can be signed in, so a missing secret reads as `false`.
 */
export const sessionTokenMatches = (cookieValue: string | undefined): Effect.Effect<boolean> =>
  sessionToken.pipe(
    Effect.map((token) => cookieValue !== undefined && cookieValue === token),
    Effect.catch(() => Effect.succeed(false)),
  );

const isSecureRequest = (request: HttpServerRequest.HttpServerRequest): boolean =>
  (request.headers["x-forwarded-proto"] ?? request.url.split(":")[0]) === "https";

/**
 * Establish a session if the PIN matches, registering a `Set-Cookie` on the
 * eventual RPC response. Returns `false` (and sets nothing) on a wrong PIN.
 */
export const establishSession = (userPin: string): Effect.Effect<boolean, NotConfigured, Request> =>
  Effect.gen(function* () {
    if (userPin !== (yield* pin)) return false;
    const token = yield* sessionToken;
    const secure = isSecureRequest(yield* HttpServerRequest.HttpServerRequest);
    yield* HttpEffect.appendPreResponseHandler((_request, response) =>
      Effect.orDie(
        HttpServerResponse.setCookie(response, COOKIE_NAME, token, {
          httpOnly: true,
          sameSite: "lax",
          // The app runs behind HTTPS in production; local dev is plain HTTP.
          secure,
          path: "/",
          maxAge: COOKIE_MAX_AGE,
        }),
      ),
    );
    return true;
  });

/** Clear the session cookie on the eventual RPC response. */
export const clearSession: Effect.Effect<void, never, Request> = Effect.gen(function* () {
  const secure = isSecureRequest(yield* HttpServerRequest.HttpServerRequest);
  yield* HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.orDie(
      HttpServerResponse.setCookie(response, COOKIE_NAME, "", {
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: 0,
      }),
    ),
  );
});
