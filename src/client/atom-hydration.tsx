import {
  HydrationBoundary,
  RegistryContext,
  RegistryProvider,
  useAtomSuspense,
} from "@effect/atom-react";
import * as Hydration from "effect/unstable/reactivity/Hydration";
import { Suspense, useContext, type ReactNode } from "react";
import { feedingsAtom, pumpingsAtom } from "./rpc";

// Read once at module load, when the server-rendered document is in the DOM.
// Undefined during SSR and on client-side navigations.
const ssrScript =
  typeof document === "undefined"
    ? undefined
    : (document.getElementById("atom-state")?.textContent ?? undefined);

const dehydratedState: Array<Hydration.DehydratedAtom> | undefined = (() => {
  if (!ssrScript) return undefined;
  try {
    const parsed: unknown = JSON.parse(ssrScript);
    return Array.isArray(parsed) ? (parsed as Array<Hydration.DehydratedAtom>) : undefined;
  } catch {
    return undefined;
  }
})();

/**
 * Wraps the tracker in an atom registry whose query state is hydrated from
 * the server render: during SSR the query atoms execute as part of rendering
 * and their settled values are serialized into the document; on the client
 * the same payload is loaded into a fresh registry before anything renders,
 * so the UI paints real data immediately (queries still revalidate in the
 * background — stale-while-revalidate). On client-side navigations there is
 * no script tag and the atoms simply fetch.
 */
export function AtomHydration({ children }: { children: ReactNode }) {
  return (
    <RegistryProvider>
      <HydrationBoundary state={dehydratedState}>
        <Suspense fallback={null}>
          {children}
          <AtomStateScript />
        </Suspense>
      </HydrationBoundary>
    </RegistryProvider>
  );
}

/**
 * Suspends until the query atoms have settled, then serializes the registry
 * on the server into a JSON script tag. On the client it re-renders the tag
 * verbatim so hydration matches the server HTML.
 */
function AtomStateScript() {
  useAtomSuspense(feedingsAtom, { includeFailure: true });
  useAtomSuspense(pumpingsAtom, { includeFailure: true });
  if (typeof window === "undefined") {
    const registry = useContext(RegistryContext);
    const json = JSON.stringify(Hydration.dehydrate(registry)).replaceAll("<", "\\u003c");
    return (
      <script id="atom-state" type="application/json" dangerouslySetInnerHTML={{ __html: json }} />
    );
  }
  return (
    <script
      id="atom-state"
      type="application/json"
      dangerouslySetInnerHTML={{ __html: ssrScript ?? "" }}
    />
  );
}
