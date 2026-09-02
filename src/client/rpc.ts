import { Layer } from "effect";
import { Predicate } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import type * as HttpClientModule from "effect/unstable/http/HttpClient";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import { Atom, AtomRpc } from "effect/unstable/reactivity";
import { MampfRpc, NotAuthed, NotConfigured, WrongPin } from "../shared/api";
import { getSsrRequest } from "../shared/ssr-bridge";

/**
 * The API as atoms: one `AtomRpc` service wires a typed RPC client to the
 * reactivity runtime, and query/mutation atoms are derived directly from the
 * shared `MampfRpc` group.
 */
class MampfApi extends AtomRpc.Service<MampfApi>()("mampf/MampfApi", {
  group: MampfRpc,
  // Built per atom, per registry: during SSR the atom registry is per request,
  // so the layer captures that request's origin and cookie and dispatches a
  // real RPC call back into the worker. In the browser this is a plain
  // same-origin `/rpc` call.
  protocol: () => {
    const ssr = getSsrRequest();
    return RpcClient.layerProtocolHttp({
      url: ssr ? `${ssr.origin}/rpc` : "/rpc",
      ...(ssr
        ? {
            transformClient: <E, R>(client: HttpClientModule.HttpClient.With<E, R>) =>
              client.pipe(HttpClient.mapRequest(HttpClientRequest.setHeader("cookie", ssr.cookie))),
          }
        : {}),
    }).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(RpcSerialization.layerJson));
  },
}) {}

// Window-focus revalidation is a client-only concern; `refreshOnWindowFocus`
// reads `window`, so it is skipped during SSR.
const onFocus = <A extends Atom.Atom<any>>(atom: A): A =>
  typeof window === "undefined" ? atom : (Atom.refreshOnWindowFocus(atom) as unknown as A);

/** Recent feedings, refreshed on window focus and invalidated by mutations. */
export const feedingsAtom = onFocus(
  MampfApi.query("ListFeedings", undefined, {
    timeToLive: "30 seconds",
    // Marks the atom serializable: during SSR its value is dehydrated into
    // the HTML and re-applied on the client (see `Hydration`).
    serializationKey: "feedings",
    reactivityKeys: ["feedings"],
  }),
);

/** Recent pumping sessions, refreshed on window focus and invalidated by mutations. */
export const pumpingsAtom = onFocus(
  MampfApi.query("ListPumpings", undefined, {
    timeToLive: "30 seconds",
    serializationKey: "pumpings",
    reactivityKeys: ["pumpings"],
  }),
);

export const loginAtom = MampfApi.mutation("Login");
export const logoutAtom = MampfApi.mutation("Logout");

export const addFeedingAtom = MampfApi.mutation("AddFeeding");
export const deleteFeedingAtom = MampfApi.mutation("DeleteFeeding");

export const addPumpingAtom = MampfApi.mutation("AddPumping");
export const deletePumpingAtom = MampfApi.mutation("DeletePumping");

/** Every error an atom can surface: tagged domain errors or transport failures. */
export type RpcError = NotAuthed | NotConfigured | WrongPin | RpcClientError;

/** A user-facing message for any RPC error. */
export const rpcErrorMessage = (error: unknown): string => {
  if (
    Predicate.hasProperty(error, "message") &&
    Predicate.isString((error as { message: unknown }).message)
  ) {
    return (error as { message: string }).message;
  }
  return "Could not reach the server. Please try again.";
};
