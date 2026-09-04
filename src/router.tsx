import { RegistryContext } from "@effect/atom-react";
import { createRouter } from "@tanstack/react-router";
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
  const router = createRouter({
    routeTree,
    context: { registry },
    defaultPreload: "intent",
    scrollRestoration: true,
    Wrap: ({ children }: { children: ReactNode }) => (
      <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
    ),
    // Loaders have already settled their queries before dehydration.
    dehydrate: () => Hydration.dehydrate(registry),
    hydrate: (state) => Hydration.hydrate(registry, state),
  });

  // Start owns streaming completion/cancellation and early redirects/errors.
  // Register before SSR attaches, rather than disposing when fetch() returns
  // (which is too early for a streaming response).
  router.serverSsrLifecycle = {
    onServerSsrAttach: [(ssr) => ssr.onCleanup(() => registry.dispose())],
  };
  return router;
}
