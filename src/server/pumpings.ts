import { Context, DateTime, Duration, Effect, Layer, Schema } from "effect";
import { Model } from "effect/unstable/schema";
import { SqlClient, SqlModel, SqlSchema } from "effect/unstable/sql";
import { PumpSide, PumpingView } from "../shared/domain";

/**
 * A single pumping session.
 *
 * Mirrors `Feeding`: `id` is a UUID v4 generated on insert, `pumpedAt` is the
 * (user provided) time the session happened as ISO-8601 UTC, `createdAt` is
 * set automatically by the Effect clock on insert.
 */
export class Pumping extends Model.Class<Pumping>("Pumping")({
  id: Model.UuidV4Insert(Schema.String.pipe(Schema.brand("PumpingId"))),
  side: PumpSide,
  durationMin: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 60 }))),
  amountMl: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 1000 }))),
  pumpedAt: Schema.DateTimeUtcFromString,
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
    add(input: {
      readonly side: PumpSide;
      readonly durationMin: number;
      readonly amountMl: number;
      readonly pumpedAt: DateTime.Utc;
    }): Effect.Effect<PumpingView>;
    remove(id: string): Effect.Effect<void>;
    listRecentDays(days: number): Effect.Effect<Array<PumpingView>>;
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

      const add = Effect.fn("Pumpings.add")(function* (input: {
        readonly side: PumpSide;
        readonly durationMin: number;
        readonly amountMl: number;
        readonly pumpedAt: DateTime.Utc;
      }) {
        // `Pumping.insert.makeEffect` fills in the generated uuid + `createdAt`
        // using the Effect clock, so tests can control time with `TestClock`.
        const inserted = yield* Pumping.insert.makeEffect(input).pipe(
          Effect.flatMap(repo.insert),
          // Database/encoding failures here are unexpected, so treat them as
          // defects to keep the service error channel focused on the domain.
          Effect.orDie,
        );
        return toView(inserted);
      });

      const remove = Effect.fn("Pumpings.remove")(function* (id: string) {
        yield* sql`DELETE FROM pumpings WHERE id = ${id}`.pipe(Effect.orDie);
      });

      const listRecentDays = Effect.fn("Pumpings.listRecentDays")(function* (days: number) {
        const now = yield* DateTime.now;
        const since = toIso(DateTime.subtractDuration(now, Duration.days(days)));
        const rows = yield* listSince(since).pipe(Effect.orDie);
        return rows.map(toView);
      });

      return Pumpings.of({ add, remove, listRecentDays });
    }),
  );
  // The `SqlClient` requirement is provided by the runtime (`src/server/runtime.ts`),
  // so the repository stays independent of the concrete database.
}
