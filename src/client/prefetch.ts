import { Effect } from "effect";
import { Atom, AtomRegistry, AsyncResult } from "effect/unstable/reactivity";

/** Wait for queries using temporary subscriptions, leaving errors in atoms for the UI. */
export const prefetchAtoms = (
  registry: AtomRegistry.AtomRegistry,
  atoms: ReadonlyArray<Atom.Atom<AsyncResult.AsyncResult<unknown, unknown>>>,
  signal: AbortSignal,
): Promise<void> =>
  Effect.runPromise(
    Effect.all(
      atoms.map((atom) =>
        Effect.exit(AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })),
      ),
      { concurrency: "unbounded", discard: true },
    ),
    { signal },
  );
