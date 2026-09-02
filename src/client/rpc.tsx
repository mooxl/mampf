import { Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { AsyncResult, Atom, AtomRpc } from "effect/unstable/reactivity";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { MampfRpc } from "../shared/api";
import { ssrFetch } from "../shared/ssr-bridge";

/**
 * The API as atoms: `MampfApi.query(...)` / `MampfApi.mutation(...)` derive
 * typed atoms from the shared `MampfRpc` group. The protocol is built per
 * registry (per request during SSR): the browser calls same-origin `/rpc`;
 * SSR dispatches in-process via `ssrFetch`. The SSR URL only needs to be
 * absolute for `new URL(...)`; the request never leaves the worker.
 */
export class MampfApi extends AtomRpc.Service<MampfApi>()("mampf/MampfApi", {
  group: MampfRpc,
  protocol: () => {
    const fetch = ssrFetch();
    return RpcClient.layerProtocolHttp({ url: fetch ? "http://ssr/rpc" : "/rpc" }).pipe(
      Layer.provide([FetchHttpClient.layer, RpcSerialization.layerJson]),
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch ?? globalThis.fetch)),
    );
  },
}) {}

/**
 * A list query: serialized into the SSR payload, invalidated by mutations with
 * the same reactivity key, and refreshed on window focus in the browser
 * (`refreshOnWindowFocus` reads `window`, so it is skipped during SSR).
 */
export const feedingsAtom = onFocus(
  MampfApi.query("ListFeedings", undefined, {
    timeToLive: "30 seconds",
    serializationKey: "feedings",
    reactivityKeys: ["feedings"],
  }),
);

export const pumpingsAtom = onFocus(
  MampfApi.query("ListPumpings", undefined, {
    timeToLive: "30 seconds",
    serializationKey: "pumpings",
    reactivityKeys: ["pumpings"],
  }),
);

function onFocus<A>(atom: Atom.Atom<A>): Atom.Atom<A> {
  return typeof window === "undefined" ? atom : Atom.refreshOnWindowFocus(atom);
}

/** Renders the failure of a query or mutation atom; waiting/success render nothing. */
export function ResultError({
  result,
}: {
  result: AsyncResult.AsyncResult<unknown, { readonly message: string }>;
}) {
  return AsyncResult.matchWithWaiting(result, {
    onWaiting: () => null,
    onSuccess: () => null,
    onError: (error) => <p className="error">{error.message}</p>,
    onDefect: () => <p className="error">Something went wrong. Please try again.</p>,
  });
}
