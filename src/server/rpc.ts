import { Effect } from "effect";
import { HttpEffect } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import type * as HttpServerRequest_ from "effect/unstable/http/HttpServerRequest";
import type { ApiError } from "../shared/api";
import { MampfRpc, NotAuthed, WrongPin } from "../shared/api";
import {
  clearSession,
  establishSession,
  requestSessionCookie,
  sessionTokenMatches,
} from "./auth.server";
import { Feedings } from "./feedings";
import { Pumpings } from "./pumpings";
import { appLayer } from "./runtime";

/** Fails with `NotAuthed` unless the request carries a valid session cookie. */
const requireAuth: Effect.Effect<void, ApiError, HttpServerRequest_.HttpServerRequest> = Effect.gen(
  function* () {
    const cookie = yield* requestSessionCookie;
    const valid = yield* Effect.catch(sessionTokenMatches(cookie), () => Effect.succeed(false));
    if (!valid) {
      return yield* new NotAuthed({ message: "Your session has expired. Please sign in again." });
    }
  },
);

/** Handlers for every RPC in `MampfRpc`. */
const MampfHandlers = MampfRpc.toLayer({
  Login: ({ pin }) =>
    Effect.gen(function* () {
      const ok = yield* establishSession(pin);
      if (!ok) {
        return yield* new WrongPin({ message: "Wrong PIN." });
      }
    }),
  Logout: () => clearSession,
  ListFeedings: () =>
    Effect.gen(function* () {
      yield* requireAuth;
      const feedings = yield* Feedings;
      return yield* feedings.listRecentDays(7);
    }),
  AddFeeding: (input) =>
    Effect.gen(function* () {
      yield* requireAuth;
      const feedings = yield* Feedings;
      return yield* feedings.add(input);
    }),
  DeleteFeeding: ({ id }) =>
    Effect.gen(function* () {
      yield* requireAuth;
      const feedings = yield* Feedings;
      yield* feedings.remove(id);
    }),
  ListPumpings: () =>
    Effect.gen(function* () {
      yield* requireAuth;
      const pumpings = yield* Pumpings;
      return yield* pumpings.listRecentDays(7);
    }),
  AddPumping: (input) =>
    Effect.gen(function* () {
      yield* requireAuth;
      const pumpings = yield* Pumpings;
      return yield* pumpings.add(input);
    }),
  DeletePumping: ({ id }) =>
    Effect.gen(function* () {
      yield* requireAuth;
      const pumpings = yield* Pumpings;
      yield* pumpings.remove(id);
    }),
});

/** The RPC server as a web handler: `Request` in, `Response` out. */
export const rpcWebHandler = HttpEffect.toWebHandler(
  RpcServer.toHttpEffect(MampfRpc).pipe(
    Effect.flatten,
    Effect.provide(MampfHandlers),
    Effect.provide(RpcSerialization.layerJson),
    Effect.provide(appLayer),
  ),
);
