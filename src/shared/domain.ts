import { Schema } from "effect";

/** Which breast(s) were pumped. */
export const PumpSide = Schema.Literals(["left", "right", "both"]);
export type PumpSide = typeof PumpSide.Type;

/**
 * Serializable shape of a feeding sent to the client (all fields plain
 * strings/numbers). The schema is shared so the RPC layer can validate and
 * decode on both ends.
 */
export const FeedingView = Schema.Struct({
  id: Schema.String,
  amountMl: Schema.Int,
  /** ISO-8601 UTC string. */
  fedAt: Schema.String,
  /** ISO-8601 UTC string. */
  createdAt: Schema.String,
});
export type FeedingView = typeof FeedingView.Type;

/** Serializable shape of a pumping session sent to the client. */
export const PumpingView = Schema.Struct({
  id: Schema.String,
  side: PumpSide,
  durationMin: Schema.Int,
  amountMl: Schema.Int,
  /** ISO-8601 UTC string. */
  pumpedAt: Schema.String,
  /** ISO-8601 UTC string. */
  createdAt: Schema.String,
});
export type PumpingView = typeof PumpingView.Type;

/** Input validated at the RPC boundary. */
export const AddFeedingInput = Schema.Struct({
  amountMl: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))),
  fedAt: Schema.DateTimeUtcFromString,
});

/** Input validated at the RPC boundary. */
export const AddPumpingInput = Schema.Struct({
  side: PumpSide,
  durationMin: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 60 }))),
  amountMl: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))),
  pumpedAt: Schema.DateTimeUtcFromString,
});
