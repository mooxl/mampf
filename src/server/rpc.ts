import { D1Client } from "@effect/sql-d1";
import { env } from "cloudflare:workers";
import { DateTime, Effect, Layer, Schema } from "effect";
import { Cookies, HttpEffect } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { SqlClient, SqlModel, SqlSchema } from "effect/unstable/sql";
import { Authed, Feeding, MampfRpc, NotAuthed, Pumping, WrongPin } from "../shared/api";
import { COOKIE_NAME, clearSession, establishSession, sessionTokenMatches } from "./auth.server";

/** The HTTP protocol merges the request headers into every RPC's headers. */
const AuthedLive = Layer.succeed(Authed, (handler, { headers }) =>
  Effect.gen(function* () {
    const cookie = headers.cookie ? Cookies.parseHeader(headers.cookie)[COOKIE_NAME] : undefined;
    if (!(yield* sessionTokenMatches(cookie))) {
      return yield* new NotAuthed({ message: "Your session has expired. Please sign in again." });
    }
    return yield* handler;
  }),
);

const Handlers = MampfRpc.toLayer(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const feedings = yield* SqlModel.makeRepository(Feeding, {
      tableName: "feedings",
      spanPrefix: "Feedings",
      idColumn: "id",
    });
    const pumpings = yield* SqlModel.makeRepository(Pumping, {
      tableName: "pumpings",
      spanPrefix: "Pumpings",
      idColumn: "id",
    });
    const recentFeedings = SqlSchema.findAll({
      Request: Schema.DateTimeUtcFromString,
      Result: Feeding,
      execute: (since) => sql`SELECT * FROM feedings WHERE fedAt >= ${since} ORDER BY fedAt DESC`,
    });
    const recentPumpings = SqlSchema.findAll({
      Request: Schema.DateTimeUtcFromString,
      Result: Pumping,
      execute: (since) =>
        sql`SELECT * FROM pumpings WHERE pumpedAt >= ${since} ORDER BY pumpedAt DESC`,
    });
    const lastWeek = DateTime.now.pipe(Effect.map(DateTime.subtract({ days: 7 })));

    // Database and encoding failures are unexpected, so they die instead of
    // widening the RPC error channels.
    return {
      Login: ({ pin }) =>
        Effect.gen(function* () {
          if (!(yield* establishSession(pin))) {
            return yield* new WrongPin({ message: "Wrong PIN." });
          }
        }),
      Logout: () => clearSession,
      ListFeedings: () => lastWeek.pipe(Effect.flatMap(recentFeedings), Effect.orDie),
      AddFeeding: (input) =>
        Feeding.insert.makeEffect(input).pipe(Effect.flatMap(feedings.insert), Effect.orDie),
      DeleteFeeding: ({ id }) => feedings.delete(id).pipe(Effect.orDie),
      ListPumpings: () => lastWeek.pipe(Effect.flatMap(recentPumpings), Effect.orDie),
      AddPumping: (input) =>
        Pumping.insert.makeEffect(input).pipe(Effect.flatMap(pumpings.insert), Effect.orDie),
      DeletePumping: ({ id }) => pumpings.delete(id).pipe(Effect.orDie),
    };
  }),
);

/** The D1 binding from `wrangler.jsonc` (`binding: "DB"`). */
const DbLive = D1Client.layer({ db: env.DB }).pipe(Layer.orDie);

const RpcLive = Layer.mergeAll(Handlers, AuthedLive, RpcSerialization.layerJson).pipe(
  Layer.provide(DbLive),
);

/** The RPC server as a web handler: `Request` in, `Response` out. */
export const rpcWebHandler = HttpEffect.toWebHandler(
  RpcServer.toHttpEffect(MampfRpc).pipe(Effect.flatten, Effect.provide(RpcLive)),
);
