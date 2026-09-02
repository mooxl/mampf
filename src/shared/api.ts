import { Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/unstable/rpc";
import { Model } from "effect/unstable/schema";

const Ml = Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 1000 })));
const FeedingId = Schema.String.pipe(Schema.brand("FeedingId"));
const PumpingId = Schema.String.pipe(Schema.brand("PumpingId"));

/**
 * Domain models. `Model.Class` derives every variant from one declaration:
 * `Feeding` (select) / `Feeding.insert` for the database, `Feeding.json` /
 * `Feeding.jsonCreate` for the RPC boundary. `id` and `createdAt` are
 * generated on insert, so they are absent from `jsonCreate`.
 */
export class Feeding extends Model.Class<Feeding>("Feeding")({
  id: Model.UuidV4Insert(FeedingId),
  amountMl: Ml,
  fedAt: Schema.DateTimeUtcFromString,
  createdAt: Model.DateTimeInsert,
}) {}

export const PumpSide = Schema.Literals(["left", "right", "both"]);
export type PumpSide = typeof PumpSide.Type;

export class Pumping extends Model.Class<Pumping>("Pumping")({
  id: Model.UuidV4Insert(PumpingId),
  side: PumpSide,
  durationMin: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 60 }))),
  amountMl: Ml,
  pumpedAt: Schema.DateTimeUtcFromString,
  createdAt: Model.DateTimeInsert,
}) {}

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

/** RPCs behind this middleware fail with `NotAuthed` without a valid session cookie. */
export class Authed extends RpcMiddleware.Service<Authed>()("mampf/Authed", {
  error: NotAuthed,
}) {}

/** The application API, shared between server handlers and client. */
export const MampfRpc = RpcGroup.make(
  Rpc.make("ListFeedings", { success: Schema.Array(Feeding.json) }),
  Rpc.make("AddFeeding", { payload: Feeding.jsonCreate, success: Feeding.json }),
  Rpc.make("DeleteFeeding", { payload: { id: FeedingId } }),
  Rpc.make("ListPumpings", { success: Schema.Array(Pumping.json) }),
  Rpc.make("AddPumping", { payload: Pumping.jsonCreate, success: Pumping.json }),
  Rpc.make("DeletePumping", { payload: { id: PumpingId } }),
)
  .middleware(Authed)
  .add(
    Rpc.make("Login", {
      payload: { pin: Schema.String },
      error: Schema.Union([WrongPin, NotConfigured]),
    }),
    Rpc.make("Logout"),
  );
