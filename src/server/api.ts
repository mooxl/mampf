import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { runtime } from "./runtime"
import { AddFeedingInput, Feedings } from "./feedings"

export const listFeedings = createServerFn({ method: "GET" }).handler(() =>
  runtime.runPromise(
    Effect.gen(function*() {
      const feedings = yield* Feedings
      return yield* feedings.listRecentDays(7)
    }),
  )
)

export const addFeeding = createServerFn({ method: "POST" })
  .validator((data: unknown) => Schema.decodeUnknownSync(AddFeedingInput)(data))
  .handler(({ data }) =>
    runtime.runPromise(
      Effect.gen(function*() {
        const feedings = yield* Feedings
        return yield* feedings.add(data)
      }),
    )
  )

export const deleteFeeding = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(data)
  )
  .handler(({ data }) =>
    runtime.runPromise(
      Effect.gen(function*() {
        const feedings = yield* Feedings
        return yield* feedings.remove(data.id)
      }),
    )
  )
