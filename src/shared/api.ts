import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
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

/** Authenticated-only RPCs can also fail because the PIN secret is unset. */
export type ApiError = NotAuthed | NotConfigured;

/** Schema for the errors authenticated-only RPCs can fail with. */
const ApiErrorSchema = Schema.Union([NotAuthed, NotConfigured]);

/**
 * The application API as a group of typed RPCs, shared between the server
 * handlers and the client. There are no paths or status codes: each RPC is a
 * tagged procedure with payload / success / error schemas.
 */
export const MampfRpc = RpcGroup.make(
  Rpc.make("Login", {
    payload: { pin: Schema.String },
    success: Schema.Void,
    // A missing PIN secret surfaces when the visitor tries to sign in.
    error: Schema.Union([WrongPin, NotConfigured]),
  }),
  Rpc.make("Logout", { success: Schema.Void }),
  Rpc.make("ListFeedings", {
    success: Schema.Array(FeedingView),
    error: ApiErrorSchema,
  }),
  Rpc.make("AddFeeding", {
    payload: AddFeedingInput,
    success: FeedingView,
    error: ApiErrorSchema,
  }),
  Rpc.make("DeleteFeeding", {
    payload: { id: Schema.String },
    success: Schema.Void,
    error: ApiErrorSchema,
  }),
  Rpc.make("ListPumpings", {
    success: Schema.Array(PumpingView),
    error: ApiErrorSchema,
  }),
  Rpc.make("AddPumping", {
    payload: AddPumpingInput,
    success: PumpingView,
    error: ApiErrorSchema,
  }),
  Rpc.make("DeletePumping", {
    payload: { id: Schema.String },
    success: Schema.Void,
    error: ApiErrorSchema,
  }),
);
