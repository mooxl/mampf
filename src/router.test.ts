import { describe, expect, it, vi } from "vite-plus/test";
import { createRootRouteWithContext } from "@tanstack/react-router";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { getRouter } from "./router";

vi.mock("./routeTree.gen", () => ({
  routeTree: createRootRouteWithContext<{ registry: AtomRegistry.AtomRegistry }>()({}),
}));

describe("SSR registry ownership", () => {
  it("disposes each request registry at SSR cleanup, not before", () => {
    const router = getRouter();
    const registry = router.options.context.registry;
    const atom = Atom.make(42);
    registry.mount(atom);
    const cleanup: Array<() => void> = [];
    // Attach only the lifecycle surface this integration uses.
    const ssr = {
      onCleanup: (callback: () => void) => {
        cleanup.push(callback);
      },
    };
    for (const attach of router.serverSsrLifecycle?.onServerSsrAttach ?? []) {
      attach(ssr as Parameters<typeof attach>[0]);
    }
    expect(registry.getNodes().size).toBe(1);
    expect(cleanup).toHaveLength(1);
    cleanup[0]!();
    expect(registry.getNodes().size).toBe(0);
    const next = getRouter();
    expect(next.options.context.registry).not.toBe(registry);
    next.options.context.registry.dispose();
  });
});
