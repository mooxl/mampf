import * as Atom from "effect/unstable/reactivity/Atom";
import {
  addFeedingWorkflow,
  addPumpingWorkflow,
  deleteFeedingWorkflow,
  deletePumpingWorkflow,
  loginWorkflow,
  logoutWorkflow,
} from "./workflows";

/**
 * Effectful workflows as atoms.
 *
 * Each `Atom.fn` is a writable atom whose value is an `AsyncResult` of the
 * workflow: writing an argument (from a form submit / button click via
 * `useAtom`) runs the Effect, exposes waiting / error / defect / success as
 * reactive state, and interrupts the previous run — so an aborted request's
 * in-flight fetch is aborted through its `AbortSignal` too.
 */
export const loginAtom = Atom.fn((pin: string) => loginWorkflow(pin));

export const logoutAtom = Atom.fn(() => logoutWorkflow());

export const addFeedingAtom = Atom.fn(
  (input: { readonly amountMl: number; readonly fedAt: string }) => addFeedingWorkflow(input),
);

export const deleteFeedingAtom = Atom.fn((id: string) => deleteFeedingWorkflow(id));

export const addPumpingAtom = Atom.fn(
  (input: {
    readonly side: "left" | "right" | "both";
    readonly durationMin: number;
    readonly amountMl: number;
    readonly pumpedAt: string;
  }) => addPumpingWorkflow(input),
);

export const deletePumpingAtom = Atom.fn((id: string) => deletePumpingWorkflow(id));
