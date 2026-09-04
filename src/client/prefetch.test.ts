import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect, Schema } from "effect";
import { Atom, AtomRegistry, AsyncResult, Hydration } from "effect/unstable/reactivity";
import { prefetchAtoms } from "./prefetch";

describe("loader atom ownership", () => {
  const registries: Array<AtomRegistry.AtomRegistry> = [];
  const makeRegistry = () => {
    const registry = AtomRegistry.make({ timeoutResolution: 1 });
    registries.push(registry);
    return registry;
  };
  afterEach(() => {
    for (const registry of registries.splice(0)) registry.dispose();
    vi.useRealTimers();
  });

  it("retains settled data for hydration without accumulating loader subscriptions", async () => {
    vi.useFakeTimers();
    const registry = makeRegistry();
    const atom = Atom.make(Effect.succeed(42)).pipe(
      Atom.setIdleTTL("30 seconds"),
      Atom.serializable({
        key: "test-query",
        schema: AsyncResult.Schema({ success: Schema.Number, error: Schema.Never }),
      }),
    );
    for (let index = 0; index < 5; index++) {
      await prefetchAtoms(registry, [atom], new AbortController().signal);
      expect(registry.getNodes().get("test-query")?.listeners.size).toBe(0);
    }
    const browser = makeRegistry();
    Hydration.hydrate(browser, Hydration.dehydrate(registry));
    expect(browser.get(atom)).toMatchObject({ _tag: "Success", value: 42 });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(registry.getNodes().has("test-query")).toBe(false);
  });

  it("leaves failures in the query atom for the existing error UI", async () => {
    const registry = makeRegistry();
    const atom = Atom.make(Effect.fail("unavailable")).pipe(Atom.setIdleTTL("30 seconds"));
    await prefetchAtoms(registry, [atom], new AbortController().signal);
    expect(registry.get(atom)._tag).toBe("Failure");
    expect(registry.getNodes().get(atom)?.listeners.size).toBe(0);
  });

  it("releases the waiting subscription when a loader is aborted", async () => {
    const registry = makeRegistry();
    const atom = Atom.make(Effect.never).pipe(Atom.setIdleTTL("30 seconds"));
    const controller = new AbortController();
    const pending = prefetchAtoms(registry, [atom], controller.signal);
    const outcome = pending.then(
      () => "settled",
      () => "aborted",
    );
    controller.abort();
    expect(await outcome).toBe("aborted");
    expect(registry.getNodes().get(atom)?.listeners.size ?? 0).toBe(0);
  });
});
