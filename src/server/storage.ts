import { Effect, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { OperationUnavailable } from "../shared/errors";

/**
 * D1 reports driver failures as SqlError (usually UnknownError). Expose a safe,
 * typed failure, but never automatically retry writes: their commit may have
 * succeeded even if the response was lost. Invalid stored data remains a defect.
 */
export const storageOperation = <A, R>(
  operation: string,
  effect: Effect.Effect<A, SqlError | Schema.SchemaError, R>,
): Effect.Effect<A, OperationUnavailable, R> =>
  effect.pipe(
    Effect.catchTag("SqlError", (error) =>
      Effect.logError("Storage operation failed", {
        operation,
        reason: error.reason._tag,
        retryable: error.isRetryable,
      }).pipe(
        Effect.andThen(
          Effect.fail(
            new OperationUnavailable({
              message: "Could not access saved entries. Please try again.",
            }),
          ),
        ),
      ),
    ),
    // Schema errors can include the offending row: do not send it over RPC.
    Effect.catchTag("SchemaError", () => Effect.die(new Error("Stored data failed validation."))),
    Effect.tapDefect(() => Effect.logError("Unexpected storage defect", { operation })),
  );
