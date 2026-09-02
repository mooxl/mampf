// Minimal ambient types for the Node built-ins used with `nodejs_compat`
// (wrangler emits no `node:` module types unless `@types/node` is installed).
declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    constructor();
    getStore(): T | undefined;
    run<R>(store: T, callback: (...args: Array<never>) => R): R;
  }
}
