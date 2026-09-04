import { D1Client } from "@effect/sql-d1";
import { Layer } from "effect";
import { env } from "cloudflare:workers";
import { Feedings } from "./feedings";
import { Pumpings } from "./pumpings";

/**
 * The D1 client is built in the RPC request's scope, not by the auth gate.
 * Layer construction failure is a configuration defect; individual SQL
 * operations expose typed failures through `storageOperation`.
 */
const DbLive = D1Client.layer({ db: env.DB }).pipe(Layer.orDie);

/** The application services and their database, as a composable layer. */
export const appLayer = Layer.merge(Feedings.layer, Pumpings.layer).pipe(Layer.provide(DbLive));
