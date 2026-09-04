import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type * as HttpServerRequest_ from "effect/unstable/http/HttpServerRequest";
import { NotConfigured, OperationUnavailable, RateLimited } from "../shared/api";
import {
  createSessionToken,
  isValidSessionSecret,
  SESSION_DURATION_SECONDS,
  verifySessionToken,
} from "./session";

/** The current HTTP request service, provided by the RPC transport. */
type Request = HttpServerRequest_.HttpServerRequest;

export const COOKIE_NAME = "mampf_session";
// Keep the family signed in on their devices, effectively forever.
const COOKIE_MAX_AGE = SESSION_DURATION_SECONDS;

interface RateLimiter {
  limit(input: { readonly key: string }): Promise<{ readonly success: boolean }>;
}

type AuthEnv = { PIN?: string; SESSION_SECRET?: string; LOGIN_RATE_LIMITER?: RateLimiter };

/**
 * The shared PIN as a typed Effect failure — a missing secret is a
 * recoverable, reportable condition, not a defect to crash a request with.
 * Set with `.dev.vars` locally and `wrangler secret put PIN` in production.
 */
export const pin: Effect.Effect<string, NotConfigured> = Effect.gen(function* () {
  const value = (env as AuthEnv).PIN;
  if (!value) {
    return yield* new NotConfigured({
      message: "PIN is not configured. Set the PIN secret in your environment.",
    });
  }
  return value;
});

const sessionConfig = Effect.gen(function* () {
  const configuredPin = yield* pin;
  const secret = (env as AuthEnv).SESSION_SECRET;
  if (!secret || !isValidSessionSecret(secret)) {
    return yield* new NotConfigured({ message: "Session signing is not configured correctly." });
  }
  return { pin: configuredPin, secret };
});

/**
 * True when `cookieValue` matches the expected session token. With no PIN
 * configured nobody can be signed in, so a missing secret reads as `false`.
 */
export const sessionTokenMatches = (cookieValue: string | undefined): Effect.Effect<boolean> =>
  sessionConfig.pipe(
    Effect.flatMap((config) => verifySessionToken(cookieValue, config)),
    Effect.catch(() => Effect.succeed(false)),
  );

const isSecureRequest = (request: HttpServerRequest.HttpServerRequest): boolean =>
  request.originalUrl.startsWith("https://");

/**
 * Establish a session if the PIN matches, registering a `Set-Cookie` on the
 * eventual RPC response. Returns `false` (and sets nothing) on a wrong PIN.
 */
export const establishSession = (
  userPin: string,
): Effect.Effect<boolean, NotConfigured | RateLimited | OperationUnavailable, Request> =>
  Effect.gen(function* () {
    const limiter = (env as AuthEnv).LOGIN_RATE_LIMITER;
    if (!limiter)
      return yield* new NotConfigured({ message: "Sign-in rate limiting is not configured." });
    const result = yield* Effect.tryPromise({
      try: () => limiter.limit({ key: "mampf:family-login" }),
      catch: () =>
        new OperationUnavailable({
          message: "Sign-in is temporarily unavailable. Please try again.",
        }),
    }).pipe(Effect.tapError(() => Effect.logWarning("Sign-in rate limiter request failed.")));
    if (!result.success) {
      return yield* new RateLimited({
        message: "Too many sign-in attempts. Please try again in a minute.",
        retryAfterSeconds: 60,
      });
    }
    const config = yield* sessionConfig;
    if (userPin !== config.pin) return false;
    const token = yield* createSessionToken(config).pipe(
      Effect.mapError(
        () => new NotConfigured({ message: "Session signing is not configured correctly." }),
      ),
    );
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
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: 0,
      }),
    ),
  );
});
