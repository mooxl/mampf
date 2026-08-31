import { RegistryProvider, useAtom } from "@effect/atom-react";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { loginAtom } from "../client/atoms";
import { isAuthed } from "../server/api";

export const Route = createFileRoute("/pin")({
  loader: async () => {
    // Already signed in? The PIN screen has nothing to offer.
    if (await isAuthed()) {
      throw redirect({ to: "/" });
    }
  },
  // A per-request Atom registry keeps the mutation atoms request-safe during SSR.
  component: () => (
    <RegistryProvider>
      <PinGate />
    </RegistryProvider>
  ),
});

function PinGate() {
  const router = useRouter();
  const [loginResult, runLogin] = useAtom(loginAtom, { mode: "promiseExit" });

  const form = useForm({
    defaultValues: { pin: "" },
    onSubmit: ({ value }) => {
      void runLogin(value.pin).then((exit) => {
        if (exit._tag === "Success") void router.navigate({ to: "/" });
      });
    },
  });

  const isSubmitting = loginResult.waiting;

  return (
    <main className="page">
      <form
        className="card form pin-gate"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <h1>Mampf</h1>
        <form.Field
          name="pin"
          validators={{
            onChange: ({ value }) => (value ? undefined : "Enter the family PIN."),
          }}
          children={(field) => (
            <label className="field">
              <span>Family PIN</span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                autoFocus
              />
              {field.state.meta.errors.length > 0 && (
                <span className="error">{field.state.meta.errors.join(", ")}</span>
              )}
            </label>
          )}
        />
        {AsyncResult.matchWithWaiting(loginResult, {
          onWaiting: () => null,
          onSuccess: () => null,
          onError: (error) => <p className="error">{error.message}</p>,
          onDefect: () => <p className="error">Something went wrong. Please try again.</p>,
        })}
        <button className="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
