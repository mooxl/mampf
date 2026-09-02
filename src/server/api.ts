import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { COOKIE_NAME, sessionTokenMatches } from "./auth.server";
import { runtime } from "./runtime";

/**
 * The one server function: the `beforeLoad` auth gate, so an unauthenticated
 * visitor gets a server-rendered redirect. Data never flows through here —
 * everything else is an Effect RPC (`src/server/rpc.ts`), and every RPC still
 * enforces auth via the `Authed` middleware.
 */
export const isAuthed = createServerFn({ method: "GET" }).handler(() =>
  runtime.runPromise(sessionTokenMatches(getCookie(COOKIE_NAME))),
);
