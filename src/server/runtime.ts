import { D1Client } from "@effect/sql-d1"
import { Layer, ManagedRuntime } from "effect"
import { env } from "cloudflare:workers"
import { Feedings } from "./feedings"
import { Pumpings } from "./pumpings"

/**
 * The D1 binding from `wrangler.jsonc` (`binding: "DB"`) wrapped as an Effect
 * layer. The binding itself is only touched when the layer is built on the
 * first effect run, i.e. inside a request context.
 */
const DbLive = D1Client.layer({ db: env.DB }).pipe(Layer.orDie)

/** The application runtime used by TanStack Start server functions. */
export const runtime = ManagedRuntime.make(
  Layer.merge(Feedings.layer, Pumpings.layer).pipe(Layer.provide(DbLive)),
)
