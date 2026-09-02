import { RegistryContext } from "@effect/atom-react";
import { createRouter } from "@tanstack/react-router";
import { Predicate } from "effect";
import { AtomRegistry, Hydration } from "effect/unstable/reactivity";
import type { ReactNode } from "react";
import { routeTree } from "./routeTree.gen";

/**
 * One atom registry per router: per request on the server, one for the app in
 * the browser. Routes reach it via `context.registry` (loaders start the query
 * atoms they need); the router dehydrates the settled atoms into its own SSR
 * payload and hydrates the client registry from it before the first render.
 */
export function getRouter() {
  const registry = AtomRegistry.make();
  return createRouter({
    routeTree,
    context: { registry },
    defaultPreload: "intent",
    scrollRestoration: true,
    Wrap: ({ children }: { children: ReactNode }) => (
      <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
    ),
    dehydrate: async () => {
      // Wait for the atoms started by loaders to leave their initial state.
      const pending = Hydration.dehydrate(registry, { encodeInitialAs: "promise" });
      await Promise.all(
        Hydration.toValues(pending)
          .map((a) => a.resultPromise)
          .filter(Predicate.isNotUndefined),
      );
      return Hydration.dehydrate(registry);
    },
    hydrate: (state) => Hydration.hydrate(registry, state),
  });
}
