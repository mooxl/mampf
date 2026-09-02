import { AsyncLocalStorage } from "node:async_hooks";
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { rpcWebHandler } from "./server/rpc";
import { setSsrStorage, type SsrRequest } from "./shared/ssr-bridge";

/**
 * Worker entry: SSR and TanStack server functions on every path, except
 * `/rpc`, which is served by the Effect RPC server.
 */
const handleStart = createStartHandler(defaultStreamHandler);

// SSR query atoms dispatch RPCs with the rendering visitor's session. The
// storage is read by the shared RPC client via `src/shared/ssr-bridge.ts`.
const ssrStorage = new AsyncLocalStorage<SsrRequest>();
setSsrStorage(ssrStorage);

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/rpc") {
      return rpcWebHandler(request);
    }
    return ssrStorage.run(
      {
        cookie: request.headers.get("cookie") ?? "",
        // SSR query atoms call the RPC handler in-process — no network
        // self-fetch, so edge routing can never touch the response.
        rpc: rpcWebHandler,
      },
      () => handleStart(request),
    );
  },
};
