import { Schema } from "effect";

export const MAX_AMOUNT_ML = 1000;
export const MAX_PUMP_DURATION_MIN = 60;

export const AmountMl = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: MAX_AMOUNT_ML })),
);
export const PumpDurationMin = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 1, maximum: MAX_PUMP_DURATION_MIN })),
);

/** IDs stay distinct through storage, RPC decoding, and UI mutations. */
export const FeedingId = Schema.String.pipe(
  Schema.check(Schema.isUUID(4)),
  Schema.brand("FeedingId"),
);
export type FeedingId = typeof FeedingId.Type;
export const PumpingId = Schema.String.pipe(
  Schema.check(Schema.isUUID(4)),
  Schema.brand("PumpingId"),
);
export type PumpingId = typeof PumpingId.Type;

/** Which breast(s) were pumped. */
export const PumpSide = Schema.Literals(["left", "right", "both"]);
export type PumpSide = typeof PumpSide.Type;

/**
 * Serializable shape of a feeding sent to the client (all fields plain
 * strings/numbers). The schema is shared so the RPC layer can validate and
 * decode on both ends.
 */
export const FeedingView = Schema.Struct({
  id: FeedingId,
  amountMl: AmountMl,
  /** ISO-8601 UTC string. */
  fedAt: Schema.String,
  /** ISO-8601 UTC string. */
  createdAt: Schema.String,
});
export type FeedingView = typeof FeedingView.Type;

/** Serializable shape of a pumping session sent to the client. */
export const PumpingView = Schema.Struct({
  id: PumpingId,
  side: PumpSide,
  durationMin: PumpDurationMin,
  amountMl: AmountMl,
  /** ISO-8601 UTC string. */
  pumpedAt: Schema.String,
  /** ISO-8601 UTC string. */
  createdAt: Schema.String,
});
export type PumpingView = typeof PumpingView.Type;

/** Input validated at the RPC boundary. */
export const AddFeedingInput = Schema.Struct({
  amountMl: AmountMl,
  fedAt: Schema.DateTimeUtcFromString,
});
export type AddFeedingInput = typeof AddFeedingInput.Type;

/** Input validated at the RPC boundary. */
export const AddPumpingInput = Schema.Struct({
  side: PumpSide,
  durationMin: PumpDurationMin,
  amountMl: AmountMl,
  pumpedAt: Schema.DateTimeUtcFromString,
});
export type AddPumpingInput = typeof AddPumpingInput.Type;
