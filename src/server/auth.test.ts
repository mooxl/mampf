import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { createSessionToken } from "./session";

const authEnv: Record<string, unknown> = {};
vi.mock("cloudflare:workers", () => ({ env: authEnv }));

const loadAuth = () => import("./auth.server");
const runExit = <A, E>(effect: Effect.Effect<A, E, HttpServerRequest.HttpServerRequest>) =>
  Effect.runPromiseExit(
    effect.pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(new Request("https://example.test/rpc")),
      ),
    ),
  );

describe("login throttling", () => {
  beforeEach(() => {
    for (const key of Object.keys(authEnv)) delete authEnv[key];
    authEnv.PIN = "1234";
    authEnv.SESSION_SECRET = "11".repeat(32);
  });

  it("checks the fixed limiter key and rejects before a correct PIN is accepted", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    authEnv.LOGIN_RATE_LIMITER = { limit };
    const { establishSession } = await loadAuth();
    const exit = await runExit(establishSession("1234"));
    expect(limit).toHaveBeenCalledWith({ key: "mampf:family-login" });
    expect(exit.toString()).toContain("RateLimited");
  });

  it("fails closed when the limiter is missing", async () => {
    const { establishSession } = await loadAuth();
    const exit = await runExit(establishSession("1234"));
    expect(exit.toString()).toContain("NotConfigured");
  });

  it.each([undefined, "short", "g".repeat(64)])(
    "rejects missing or invalid signing configuration (%s)",
    async (secret) => {
      authEnv.SESSION_SECRET = secret;
      authEnv.LOGIN_RATE_LIMITER = { limit: () => Promise.resolve({ success: true }) };
      const { establishSession } = await loadAuth();
      const exit = await runExit(establishSession("1234"));
      expect(exit.toString()).toContain("NotConfigured");
    },
  );

  it("verifies sessions without a database and fails closed when secrets disappear", async () => {
    const token = await Effect.runPromise(
      createSessionToken({ pin: "1234", secret: "11".repeat(32) }),
    );
    const { sessionTokenMatches } = await loadAuth();
    expect(await Effect.runPromise(sessionTokenMatches(token))).toBe(true);
    delete authEnv.SESSION_SECRET;
    expect(await Effect.runPromise(sessionTokenMatches(token))).toBe(false);
    authEnv.SESSION_SECRET = "11".repeat(32);
    delete authEnv.PIN;
    expect(await Effect.runPromise(sessionTokenMatches(token))).toBe(false);
  });

  it("sanitizes limiter binding failures as OperationUnavailable", async () => {
    authEnv.LOGIN_RATE_LIMITER = {
      limit: () => Promise.reject(new Error("sensitive binding detail")),
    };
    const { establishSession } = await loadAuth();
    const exit = await runExit(establishSession("1234"));
    expect(exit.toString()).toContain("OperationUnavailable");
    expect(exit.toString()).not.toContain("sensitive binding detail");
  });

  it("counts wrong PIN attempts and returns false", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    authEnv.LOGIN_RATE_LIMITER = { limit };
    const { establishSession } = await loadAuth();
    const exit = await runExit(establishSession("wrong"));
    expect(exit.toString()).toContain("Success(false)");
    expect(limit).toHaveBeenCalledOnce();
  });

  it("sets hardened cookie flags from the actual request transport", async () => {
    authEnv.LOGIN_RATE_LIMITER = { limit: () => Promise.resolve({ success: true }) };
    const { COOKIE_NAME, establishSession } = await loadAuth();
    const app = HttpEffect.toWebHandler(
      establishSession("1234").pipe(Effect.as(HttpServerResponse.empty())),
    );
    const secureResponse = await app(new Request("https://example.test/rpc"));
    const secureCookie = secureResponse.headers.get("set-cookie") ?? "";
    expect(secureCookie).toContain(`${COOKIE_NAME}=v1.`);
    expect(secureCookie).toContain("HttpOnly");
    expect(secureCookie).toContain("SameSite=Lax");
    expect(secureCookie).toContain("Path=/");
    expect(secureCookie).toContain("Secure");

    const insecureResponse = await app(
      new Request("http://example.test/rpc", { headers: { "x-forwarded-proto": "https" } }),
    );
    expect(insecureResponse.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("clears a compatible hardened cookie", async () => {
    const { clearSession, COOKIE_NAME } = await loadAuth();
    const app = HttpEffect.toWebHandler(clearSession.pipe(Effect.as(HttpServerResponse.empty())));
    const response = await app(new Request("https://example.test/rpc"));
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${COOKIE_NAME}=`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
  });
});
