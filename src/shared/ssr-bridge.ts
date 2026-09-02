import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { rpcWebHandler } from "../server/rpc";

export interface SsrRequest {
  readonly cookie: string;
  /** Runs the RPC handler in-process for the rendering request. */
  readonly rpc: (request: Request) => Promise<Response>;
}

/**
 * During SSR, the rendering visitor's cookie and an in-process RPC dispatcher,
 * so query atoms execute with their session without a network self-fetch.
 * `createIsomorphicFn` keeps the server branch (and its imports) out of the
 * client bundle; in the browser this is always `undefined`.
 */
export const getSsrRequest = createIsomorphicFn()
  .server((): SsrRequest | undefined => ({
    cookie: getRequest().headers.get("cookie") ?? "",
    rpc: rpcWebHandler,
  }))
  .client((): SsrRequest | undefined => undefined);
