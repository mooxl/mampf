import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { rpcWebHandler } from "../server/rpc";

/**
 * During SSR, a `fetch` that dispatches RPC requests to the in-process handler
 * with the rendering visitor's cookie, so query atoms run with their session
 * and without a network self-fetch. `createIsomorphicFn` keeps the server
 * branch (and its imports) out of the client bundle, where this is `undefined`.
 */
export const ssrFetch = createIsomorphicFn()
  .server((): typeof fetch | undefined => {
    const cookie = getRequest().headers.get("cookie") ?? "";
    return (input, init) => {
      const request = new Request(input, init);
      request.headers.set("cookie", cookie);
      return rpcWebHandler(request);
    };
  })
  .client((): typeof fetch | undefined => undefined);
