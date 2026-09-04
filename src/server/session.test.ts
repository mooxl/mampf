import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { createSessionToken, SESSION_DURATION_SECONDS, verifySessionToken } from "./session";

const config = { pin: "1234", secret: "11".repeat(32) };

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

describe("session tokens", () => {
  afterEach(() => vi.useRealTimers());

  it("round trips and randomizes each login", async () => {
    const first = await run(createSessionToken(config));
    const second = await run(createSessionToken(config));
    expect(first).not.toBe(second);
    expect(await run(verifySessionToken(first, config))).toBe(true);
    expect(await run(verifySessionToken(second, config))).toBe(true);
  });

  it("expires and rejects an excessive future lifetime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = await run(createSessionToken(config));
    vi.advanceTimersByTime((SESSION_DURATION_SECONDS + 1) * 1_000);
    expect(await run(verifySessionToken(token, config))).toBe(false);

    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    expect(await run(verifySessionToken(token, config))).toBe(false);
  });

  it("rejects tampering, malformed and legacy tokens", async () => {
    const token = await run(createSessionToken(config));
    const parts = token.split(".");
    const nonce = parts[2]!;
    const signature = parts[3]!;
    const changeFirst = (value: string) => `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
    const variants = [
      `${parts[0]}.${parts[1]}.${changeFirst(nonce)}.${signature}`,
      `${parts[0]}.${Number(parts[1]) - 1}.${nonce}.${signature}`,
      `${parts[0]}.${parts[1]}.${nonce}.${changeFirst(signature)}`,
      "a".repeat(64),
      "v1.bad.token.signature",
      "",
    ];
    for (const variant of variants)
      expect(await run(verifySessionToken(variant, config))).toBe(false);
  });

  it("binds both the secret and current PIN", async () => {
    const token = await run(createSessionToken(config));
    expect(await run(verifySessionToken(token, { ...config, pin: "4321" }))).toBe(false);
    expect(await run(verifySessionToken(token, { ...config, secret: "22".repeat(32) }))).toBe(
      false,
    );
    expect(await run(verifySessionToken(token, { ...config, secret: "short" }))).toBe(false);
  });
});
