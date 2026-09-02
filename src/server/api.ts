import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { Effect } from "effect";
import { COOKIE_NAME, sessionToken } from "./auth.server";
import { runtime } from "./runtime";

/**
 * The one server-function module. TanStack Start requires route-callable
 * server functions to live in a module the client bundler can mock out, so
 * this file must stay free of any other server-only imports.
 *
 * Data never flows through here: login, logout, CRUD, and the SSR-rendered
 * lists all go through the Effect RPC layer (`src/server/rpc.ts` +
 * `src/client/rpc.ts`). This is only the `beforeLoad` auth gate — a
 * server-rendered redirect beats a client-side one.
 */

/** True when the request carries a valid session cookie. */
export const isAuthed = createServerFn({ method: "GET" }).handler(() =>
  runtime.runPromise(
    Effect.map(
      Effect.catch(sessionToken, () => Effect.succeed(undefined)),
      (token) => token !== undefined && token === getCookie(COOKIE_NAME),
    ),
  ),
);
