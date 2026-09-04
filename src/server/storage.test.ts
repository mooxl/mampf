import { describe, expect, it } from "vite-plus/test";
import { Cause, Effect, Logger, Schema } from "effect";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";
import { OperationUnavailable } from "../shared/errors";
import { storageOperation } from "./storage";

describe("storage error policy", () => {
  it("maps driver failures to a typed RPC-safe error and logs only safe metadata", async () => {
    const logs: Array<unknown> = [];
    const driverError = new SqlError({
      reason: new UnknownError({
        cause: new Error("private row or query"),
        message: "private row or query",
      }),
    });
    const result = await Effect.runPromise(
      storageOperation("Feedings.add", Effect.fail(driverError)).pipe(
        Effect.result,
        Effect.provide(Logger.layer([Logger.make(({ message }) => logs.push(message))])),
      ),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected storage failure");
    expect(result.failure).toBeInstanceOf(OperationUnavailable);
    const encoded = Schema.encodeSync(OperationUnavailable)(result.failure);
    expect(encoded).toEqual({
      _tag: "OperationUnavailable",
      message: "Could not access saved entries. Please try again.",
    });
    expect(JSON.stringify(logs)).toContain("Feedings.add");
    expect(JSON.stringify(logs)).toContain("UnknownError");
    expect(JSON.stringify({ encoded, logs })).not.toContain("private row or query");
  });

  it("keeps schema failures as sanitized defects, not operational failures", async () => {
    const result = await Effect.runPromiseExit(
      storageOperation(
        "Feedings.listRecentDays",
        Schema.decodeUnknownEffect(Schema.Number)("private row"),
      ),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected schema defect");
    expect(Cause.hasDies(result.cause)).toBe(true);
    expect(result.toString()).toContain("Stored data failed validation");
    expect(result.toString()).not.toContain("private row");
  });

  it("does not change success or retry a failed operation", async () => {
    expect(await Effect.runPromise(storageOperation("read", Effect.succeed(42)))).toBe(42);
    let attempts = 0;
    await Effect.runPromiseExit(
      storageOperation(
        "write",
        Effect.suspend(() => {
          attempts++;
          return Effect.fail(
            new SqlError({ reason: new UnknownError({ cause: "lost response" }) }),
          );
        }),
      ),
    );
    expect(attempts).toBe(1);
  });
});
