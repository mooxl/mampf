import { Schema } from "effect";

export class NotAuthed extends Schema.TaggedError<NotAuthed>()("NotAuthed", {
  message: Schema.String,
}) {}

export class WrongPin extends Schema.TaggedError<WrongPin>()("WrongPin", {
  message: Schema.String,
}) {}

/** Missing or invalid deployment configuration, never secret values. */
export class NotConfigured extends Schema.TaggedError<NotConfigured>()("NotConfigured", {
  message: Schema.String,
}) {}

export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
  message: Schema.String,
  retryAfterSeconds: Schema.Int,
}) {}

/** Safe public failure for an unavailable dependency; internal details stay on the server. */
export class OperationUnavailable extends Schema.TaggedError<OperationUnavailable>()(
  "OperationUnavailable",
  { message: Schema.String },
) {}
