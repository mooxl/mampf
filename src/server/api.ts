import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";
import { runtime } from "./runtime";
import { AddFeedingInput, Feedings } from "./feedings";
import { AddPumpingInput, Pumpings } from "./pumpings";
import { clearSession, establishSession, sessionValid } from "./auth.server";
import {
  NotAuthed,
  WrongPin,
  type ApiError,
  type ApiErrorData,
  type ApiResult,
} from "../shared/api";

/**
 * Runs an Effect and collapses both channels into the JSON-safe `ApiResult`
 * envelope, so failures cross the wire as tagged data instead of thrown
 * errors. Unexpected defects (bugs, database failures — the services `orDie`
 * them) still reject the promise and surface as HTTP errors.
 */
function send<A, E extends ApiError>(
  effect: Effect.Effect<A, E, Feedings | Pumpings>,
): Promise<ApiResult<A>> {
  return runtime.runPromise(
    Effect.match(effect, {
      onSuccess: (value) => ({ _tag: "Ok" as const, value: value ?? null }) as ApiResult<A>,
      onFailure: (error) => ({
        _tag: "Err" as const,
        error: { _tag: error._tag, message: error.message },
      }),
    }),
  );
}

/** Fails with `NotAuthed` unless the request carries a valid session cookie. */
const requireAuth = Effect.gen(function* () {
  const valid = yield* Effect.promise(() => sessionValid());
  if (!valid) {
    return yield* new NotAuthed({ message: "Your session has expired. Please sign in again." });
  }
});

export const isAuthed = createServerFn({ method: "GET" }).handler(() => sessionValid());

export const login = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    Schema.decodeUnknownSync(Schema.Struct({ pin: Schema.String }))(data),
  )
  .handler(({ data }) =>
    send(
      Effect.gen(function* () {
        const ok = yield* Effect.promise(() => establishSession(data.pin));
        if (!ok) {
          return yield* new WrongPin({ message: "Wrong PIN." });
        }
      }),
    ),
  );

export const logout = createServerFn({ method: "POST" }).handler(() =>
  send(Effect.sync(() => clearSession())),
);

export const listFeedings = createServerFn({ method: "GET" }).handler(() =>
  send(
    Effect.gen(function* () {
      yield* requireAuth;
      const feedings = yield* Feedings;
      return yield* feedings.listRecentDays(7);
    }),
  ),
);

export const addFeeding = createServerFn({ method: "POST" })
  .validator((data: unknown) => Schema.decodeUnknownSync(AddFeedingInput)(data))
  .handler(({ data }) =>
    send(
      Effect.gen(function* () {
        yield* requireAuth;
        const feedings = yield* Feedings;
        return yield* feedings.add(data);
      }),
    ),
  );

export const deleteFeeding = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(data),
  )
  .handler(({ data }) =>
    send(
      Effect.gen(function* () {
        yield* requireAuth;
        const feedings = yield* Feedings;
        return yield* feedings.remove(data.id);
      }),
    ),
  );

export const listPumpings = createServerFn({ method: "GET" }).handler(() =>
  send(
    Effect.gen(function* () {
      yield* requireAuth;
      const pumpings = yield* Pumpings;
      return yield* pumpings.listRecentDays(7);
    }),
  ),
);

export const addPumping = createServerFn({ method: "POST" })
  .validator((data: unknown) => Schema.decodeUnknownSync(AddPumpingInput)(data))
  .handler(({ data }) =>
    send(
      Effect.gen(function* () {
        yield* requireAuth;
        const pumpings = yield* Pumpings;
        return yield* pumpings.add(data);
      }),
    ),
  );

export const deletePumping = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(data),
  )
  .handler(({ data }) =>
    send(
      Effect.gen(function* () {
        yield* requireAuth;
        const pumpings = yield* Pumpings;
        return yield* pumpings.remove(data.id);
      }),
    ),
  );
