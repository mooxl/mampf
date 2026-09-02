import { useAtom } from "@effect/atom-react";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { Exit } from "effect";
import { MampfApi, ResultError } from "../client/rpc";
import { isAuthed } from "../server/api";

export const Route = createFileRoute("/pin")({
  loader: async () => {
    // Already signed in? The PIN screen has nothing to offer.
    if (await isAuthed()) {
      throw redirect({ to: "/" });
    }
  },
  component: PinGate,
});

function PinGate() {
  const router = useRouter();
  const [loginResult, login] = useAtom(MampfApi.mutation("Login"), { mode: "promiseExit" });

  const form = useForm({
    defaultValues: { pin: "" },
    onSubmit: async ({ value }) => {
      const exit = await login({ payload: value });
      if (Exit.isSuccess(exit)) await router.navigate({ to: "/" });
    },
  });

  return (
    <main className="page">
      <form
        className="card form pin-gate"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <h1>Mampf</h1>
        <form.Field
          name="pin"
          children={(field) => (
            <label className="field">
              <span>Family PIN</span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                required
                autoFocus
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </label>
          )}
        />
        <ResultError result={loginResult} />
        <button className="primary" type="submit" disabled={loginResult.waiting}>
          {loginResult.waiting ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
