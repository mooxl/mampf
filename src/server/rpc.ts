import { Effect, Layer } from "effect";
import { Cookies, HttpEffect } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { Authed, MampfRpc, NotAuthed, WrongPin } from "../shared/api";
import { COOKIE_NAME, clearSession, establishSession, sessionTokenMatches } from "./auth.server";
import { Feedings } from "./feedings";
import { Pumpings } from "./pumpings";
import { appLayer } from "./runtime";

/**
 * `Authed` middleware: fails with `NotAuthed` unless the session cookie is
 * valid. The HTTP protocol merges the HTTP request headers into every RPC
 * request's headers, so the cookie arrives in `headers`.
 */
const AuthedLive = Layer.succeed(Authed, (handler, { headers }) =>
  Effect.gen(function* () {
    const cookie = headers["cookie"]
      ? Cookies.parseHeader(headers["cookie"])[COOKIE_NAME]
      : undefined;
    const valid = yield* sessionTokenMatches(cookie);
    if (!valid) {
      return yield* new NotAuthed({ message: "Your session has expired. Please sign in again." });
    }
    return yield* handler;
  }),
);

/** Handlers for every RPC in `MampfRpc`. */
const MampfHandlers = MampfRpc.toLayer(
  Effect.gen(function* () {
    const feedings = yield* Feedings;
    const pumpings = yield* Pumpings;
    return {
      Login: ({ pin }) =>
        Effect.gen(function* () {
          const ok = yield* establishSession(pin);
          if (!ok) {
            return yield* new WrongPin({ message: "Wrong PIN." });
          }
        }),
      Logout: () => clearSession,
      ListFeedings: () => feedings.listRecentDays(7),
      AddFeeding: (input) => feedings.add(input),
      DeleteFeeding: ({ id }) => feedings.remove(id),
      ListPumpings: () => pumpings.listRecentDays(7),
      AddPumping: (input) => pumpings.add(input),
      DeletePumping: ({ id }) => pumpings.remove(id),
    };
  }),
);

/** The RPC server as a web handler: `Request` in, `Response` out. */
export const rpcWebHandler = HttpEffect.toWebHandler(
  RpcServer.toHttpEffect(MampfRpc).pipe(
    Effect.flatten,
    Effect.provide(MampfHandlers),
    Effect.provide(AuthedLive),
    Effect.provide(RpcSerialization.layerJson),
    Effect.provide(appLayer),
  ),
);
