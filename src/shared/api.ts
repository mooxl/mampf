import { Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/unstable/rpc";
import {
  AddFeedingInput,
  AddPumpingInput,
  FeedingId,
  FeedingView,
  PumpingId,
  PumpingView,
} from "./domain";
import { NotAuthed, NotConfigured, OperationUnavailable, RateLimited, WrongPin } from "./errors";

export { NotAuthed, NotConfigured, OperationUnavailable, RateLimited, WrongPin } from "./errors";

/**
 * Session-gate middleware: RPCs behind it fail with `NotAuthed` unless the
 * request carries a valid session cookie. Implemented in `src/server/rpc.ts`;
 * the client needs nothing (the cookie travels with the request).
 */
export class Authed extends RpcMiddleware.Service<Authed>()("mampf/Authed", {
  error: NotAuthed,
}) {}

/**
 * The application API as a group of typed RPCs, shared between the server
 * handlers and the client. There are no paths or status codes: each RPC is a
 * tagged procedure with payload / success / error schemas.
 */
export const MampfRpc = RpcGroup.make(
  Rpc.make("ListFeedings", { success: Schema.Array(FeedingView), error: OperationUnavailable }),
  Rpc.make("AddFeeding", {
    payload: AddFeedingInput,
    success: FeedingView,
    error: OperationUnavailable,
  }),
  Rpc.make("DeleteFeeding", {
    payload: { id: FeedingId },
    success: Schema.Void,
    error: OperationUnavailable,
  }),
  Rpc.make("ListPumpings", { success: Schema.Array(PumpingView), error: OperationUnavailable }),
  Rpc.make("AddPumping", {
    payload: AddPumpingInput,
    success: PumpingView,
    error: OperationUnavailable,
  }),
  Rpc.make("DeletePumping", {
    payload: { id: PumpingId },
    success: Schema.Void,
    error: OperationUnavailable,
  }),
)
  .middleware(Authed)
  .add(
    Rpc.make("Login", {
      payload: { pin: Schema.String },
      success: Schema.Void,
      // A missing PIN secret surfaces when the visitor tries to sign in.
      error: Schema.Union([WrongPin, NotConfigured, RateLimited, OperationUnavailable]),
    }),
    Rpc.make("Logout", { success: Schema.Void }),
  );
