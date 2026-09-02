/**
 * Bridge between the worker entry and the shared RPC client during SSR.
 *
 * The worker entry stores an `AsyncLocalStorage` under a well-known key
 * (see `src/worker-entry.ts`). During server rendering, the RPC client reads
 * the current request's cookie and RPC dispatcher from it, so query atoms
 * execute with the visitor's session — without importing any server-only
 * module into the client bundle. In the browser this is always `undefined`
 * and the client talks to `/rpc` directly.
 */
export interface SsrRequest {
  readonly cookie: string;
  /** Runs the RPC handler in-process for the rendering request. */
  readonly rpc: (request: Request) => Promise<Response>;
}

export interface SsrStorage {
  getStore(): SsrRequest | undefined;
}

const KEY = "__mampf_ssr_storage__";

export const setSsrStorage = (storage: SsrStorage): void => {
  (globalThis as Record<string, unknown>)[KEY] = storage;
};

export const getSsrRequest = (): SsrRequest | undefined => {
  if (typeof window !== "undefined") return undefined;
  const storage = (globalThis as Record<string, unknown>)[KEY] as SsrStorage | undefined;
  return storage?.getStore();
};
