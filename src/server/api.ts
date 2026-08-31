import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { runtime } from "./runtime"
import { AddFeedingInput, Feedings } from "./feedings"
import { clearSession, establishSession, sessionValid } from "./auth.server"

async function requireAuth(): Promise<void> {
  if (!(await sessionValid())) {
    throw new Error("Not signed in")
  }
}

export const isAuthed = createServerFn({ method: "GET" }).handler(() => sessionValid())

export const login = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    Schema.decodeUnknownSync(Schema.Struct({ pin: Schema.String }))(data)
  )
  .handler(({ data }) => establishSession(data.pin))

export const logout = createServerFn({ method: "POST" }).handler(() => {
  clearSession()
})

export const listFeedings = createServerFn({ method: "GET" }).handler(async () => {
  await requireAuth()
  return runtime.runPromise(
    Effect.gen(function*() {
      const feedings = yield* Feedings
      return yield* feedings.listRecentDays(7)
    }),
  )
})

export const addFeeding = createServerFn({ method: "POST" })
  .validator((data: unknown) => Schema.decodeUnknownSync(AddFeedingInput)(data))
  .handler(async ({ data }) => {
    await requireAuth()
    return runtime.runPromise(
      Effect.gen(function*() {
        const feedings = yield* Feedings
        return yield* feedings.add(data)
      }),
    )
  })

export const deleteFeeding = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(data)
  )
  .handler(async ({ data }) => {
    await requireAuth()
    return runtime.runPromise(
      Effect.gen(function*() {
        const feedings = yield* Feedings
        return yield* feedings.remove(data.id)
      }),
    )
  })
