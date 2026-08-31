import { Schema } from "effect";

/**
 * Tagged errors, per Effect v4 best practice: defined once with
 * `Schema.TaggedError`, so they are real classes (yieldable, `instanceof`)
 * on the server and have a Schema for the wire.
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

/** Transport/protocol failure on the client (network error, 5xx, bad shape). */
export class RequestFailed extends Schema.TaggedError<RequestFailed>()("RequestFailed", {
  message: Schema.String,
}) {}

/** Every error that can cross the server-function boundary. */
export type ApiError = NotAuthed | WrongPin | NotConfigured | RequestFailed;

/**
 * How a tagged error looks on the wire: plain, JSON-serializable data. The
 * server serializes `Schema.TaggedError` instances to this shape, and clients
 * read `_tag`/`message` from it.
 */
export type ApiErrorData = {
  readonly _tag: ApiError["_tag"];
  readonly message: string;
};

/**
 * Wire envelope for server functions. Successes carry `value`, failures carry
 * the serialized tagged error. `value` is `null` for operations without a
 * result (JSON has no `undefined`).
 */
export interface ApiOk<A> {
  readonly _tag: "Ok";
  readonly value: A | null;
}

export interface ApiErr {
  readonly _tag: "Err";
  readonly error: ApiErrorData;
}

export type ApiResult<A> = ApiOk<A> | ApiErr;
