import { Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/unstable/rpc";
import { AddFeedingInput, AddPumpingInput, FeedingView, PumpingView } from "./domain";

/**
 * Tagged errors, per Effect v4 best practice: defined once with
 * `Schema.TaggedError`, so they are real classes (yieldable, `instanceof`)
 * on the server and have a Schema for the wire. The RPC layer serializes and
 * decodes them automatically — no envelope needed.
 */
export class NotAuthed extends Schema.TaggedError<NotAuthed>()("NotAuthed", {
  message: Schema.String,
}) {}

/** The submitted family PIN did not match. */
export class WrongPin extends Schema.TaggedError<WrongPin>()("WrongPin", {
  message: Schema.String,
}) {}

/** The server's `PIN` secret is missing (deployment misconfiguration). */
export class NotConfigured extends Schema.TaggedError<NotConfigured>()("NotConfigured", {
  message: Schema.String,
}) {}

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
  Rpc.make("ListFeedings", { success: Schema.Array(FeedingView) }),
  Rpc.make("AddFeeding", { payload: AddFeedingInput, success: FeedingView }),
  Rpc.make("DeleteFeeding", { payload: { id: Schema.String }, success: Schema.Void }),
  Rpc.make("ListPumpings", { success: Schema.Array(PumpingView) }),
  Rpc.make("AddPumping", { payload: AddPumpingInput, success: PumpingView }),
  Rpc.make("DeletePumping", { payload: { id: Schema.String }, success: Schema.Void }),
)
  .middleware(Authed)
  .add(
    Rpc.make("Login", {
      payload: { pin: Schema.String },
      success: Schema.Void,
      // A missing PIN secret surfaces when the visitor tries to sign in.
      error: Schema.Union([WrongPin, NotConfigured]),
    }),
    Rpc.make("Logout", { success: Schema.Void }),
  );
