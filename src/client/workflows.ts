import { Effect } from "effect";
import {
  addFeeding,
  addPumping,
  deleteFeeding,
  deletePumping,
  listFeedings,
  listPumpings,
  login,
  logout,
} from "../server/api";
import type { FeedingView } from "../server/feedings";
import type { PumpingView } from "../server/pumpings";
import type { ApiErrorData, ApiResult } from "../shared/api";

/**
 * Effectful workflows on the client: every save/delete/login is described as
 * an Effect here and executed by the Atom runtime (`src/client/atoms.ts`).
 *
 * A workflow maps one server-function call through the `ApiResult` envelope:
 * transport problems become `RequestFailed`, tagged failures are raised as
 * plain `ApiErrorData` values, and the success value is unwrapped.
 */

/** The abort signal is forwarded into the RPC so interrupted atoms cancel the in-flight request. */
const call = <A>(
  fn: (signal: AbortSignal) => Promise<ApiResult<A>>,
): Effect.Effect<A, ApiErrorData> =>
  Effect.tryPromise({
    try: (signal) => fn(signal),
    catch: (): ApiErrorData => ({
      _tag: "RequestFailed",
      message: "Could not reach the server. Please try again.",
    }),
  }).pipe(Effect.flatMap(unwrap));

function unwrap<A>(envelope: ApiResult<A>): Effect.Effect<A, ApiErrorData> {
  if (envelope._tag === "Ok") return Effect.succeed(envelope.value as A);
  return Effect.fail(envelope.error);
}

// --- Mutation workflows (run by the atoms in `src/client/atoms.ts`) ----------

export const loginWorkflow = (pin: string) => call(() => login({ data: { pin } }));

export const logoutWorkflow = () => call(() => logout());

export const addFeedingWorkflow = (input: { readonly amountMl: number; readonly fedAt: string }) =>
  call((signal) => addFeeding({ data: input, signal }));

export const deleteFeedingWorkflow = (id: string) =>
  call((signal) => deleteFeeding({ data: { id }, signal }));

export const addPumpingWorkflow = (input: {
  readonly side: "left" | "right" | "both";
  readonly durationMin: number;
  readonly amountMl: number;
  readonly pumpedAt: string;
}) => call((signal) => addPumping({ data: input, signal }));

export const deletePumpingWorkflow = (id: string) =>
  call((signal) => deletePumping({ data: { id }, signal }));

// --- Query workflows (read by the query atoms in `src/client/atoms.ts`) ------

/** List recent feedings for a signed-in visitor. */
export const listFeedingsWorkflow = () => call((signal) => listFeedings({ signal }));

/** List recent pumping sessions for a signed-in visitor. */
export const listPumpingsWorkflow = () => call((signal) => listPumpings({ signal }));

// --- Route-loader helpers (seed the query atoms' initial values) --------------

/**
 * Load recent feedings for a signed-in visitor. Only used by the index route's
 * loader so the server render (and blocking client navigations) start the
 * query atoms with real data instead of an empty registry.
 */
export async function loadFeedings(): Promise<Array<FeedingView>> {
  const envelope = await listFeedings();
  if (envelope._tag === "Err") throw new Error(envelope.error.message);
  return envelope.value as Array<FeedingView>;
}

/** Load recent pumping sessions for a signed-in visitor (see `loadFeedings`). */
export async function loadPumpings(): Promise<Array<PumpingView>> {
  const envelope = await listPumpings();
  if (envelope._tag === "Err") throw new Error(envelope.error.message);
  return envelope.value as Array<PumpingView>;
}
