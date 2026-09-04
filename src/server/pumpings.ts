import { Context, DateTime, Duration, Effect, Layer, Schema } from "effect";
import { Model } from "effect/unstable/schema";
import { SqlClient, SqlModel, SqlSchema } from "effect/unstable/sql";
import { AddPumpingInput, PumpingId, PumpingView } from "../shared/domain";
import type { OperationUnavailable } from "../shared/errors";
import { storageOperation } from "./storage";

/**
 * A single pumping session.
 *
 * Mirrors `Feeding`: `id` is a UUID v4 generated on insert, `pumpedAt` is the
 * (user provided) time the session happened as ISO-8601 UTC, `createdAt` is
 * set automatically by the Effect clock on insert.
 */
export class Pumping extends Model.Class<Pumping>("Pumping")({
  id: Model.UuidV4Insert(PumpingId),
  ...AddPumpingInput.fields,
  createdAt: Model.DateTimeInsert,
}) {}

const toView = (pumping: Pumping): PumpingView => ({
  id: pumping.id,
  side: pumping.side,
  durationMin: pumping.durationMin,
  amountMl: pumping.amountMl,
  pumpedAt: DateTime.formatIso(pumping.pumpedAt),
  createdAt: DateTime.formatIso(pumping.createdAt),
});

const toIso = (dt: DateTime.DateTime): string => DateTime.formatIso(DateTime.toUtc(dt));

/**
 * Repository service for pumping sessions. The rest of the app depends on
 * `Pumpings` instead of the database client, so the storage backend stays
 * swappable.
 */
export class Pumpings extends Context.Service<
  Pumpings,
  {
    add(input: AddPumpingInput): Effect.Effect<PumpingView, OperationUnavailable>;
    remove(id: PumpingId): Effect.Effect<void, OperationUnavailable>;
    listRecentDays(days: number): Effect.Effect<Array<PumpingView>, OperationUnavailable>;
  }
>()("mampf/server/Pumpings") {
  static readonly layer = Layer.effect(
    Pumpings,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const repo = yield* SqlModel.makeRepository(Pumping, {
        tableName: "pumpings",
        spanPrefix: "Pumpings",
        idColumn: "id",
      });

      const listSince = SqlSchema.findAll({
        Request: Schema.String,
        Result: Pumping,
        execute: (since) =>
          sql`SELECT * FROM pumpings WHERE pumpedAt >= ${since} ORDER BY pumpedAt DESC`,
      });

      const add = Effect.fn("Pumpings.add")(function* (input: AddPumpingInput) {
        // `Pumping.insert.makeEffect` fills in the generated uuid + `createdAt`
        // using the Effect clock, so tests can control time with `TestClock`.
        const inserted = yield* storageOperation(
          "Pumpings.add",
          Pumping.insert.makeEffect(input).pipe(
            Effect.mapError((issue) => new Schema.SchemaError(issue)),
            Effect.flatMap(repo.insert),
          ),
        );
        return toView(inserted);
      });

      const remove = Effect.fn("Pumpings.remove")(function* (id: PumpingId) {
        yield* storageOperation("Pumpings.remove", repo.delete(id));
      });

      const listRecentDays = Effect.fn("Pumpings.listRecentDays")(function* (days: number) {
        const now = yield* DateTime.now;
        const since = toIso(DateTime.subtractDuration(now, Duration.days(days)));
        const rows = yield* storageOperation("Pumpings.listRecentDays", listSince(since));
        return rows.map(toView);
      });

      return Pumpings.of({ add, remove, listRecentDays });
    }),
  );
  // The `SqlClient` requirement is provided by the runtime (`src/server/runtime.ts`),
  // so the repository stays independent of the concrete database.
}
