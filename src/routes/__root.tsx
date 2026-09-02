import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  useRouter,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import type { AtomRegistry } from "effect/unstable/reactivity";
import { useTransition } from "react";
import styles from "../styles.css?url";

export const Route = createRootRouteWithContext<{ registry: AtomRegistry.AtomRegistry }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
      },
      { title: "Mampf 🍼" },
    ],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  errorComponent: RouteError,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Retry-friendly replacement for the default error screen: loader/component
 * failures (expired session, network or database hiccup) render the error
 * message with a "Try again" button that re-runs the loaders.
 */
function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const message =
    error instanceof Error && error.message
      ? error.message
      : "Something went wrong while loading Mampf.";

  const retry = () => {
    // Re-run the loaders, then clear the error boundary so the route re-renders.
    startTransition(async () => {
      await router.invalidate();
      reset();
    });
  };

  return (
    <main className="page">
      <div className="card form">
        <span className="pin-logo">🍼</span>
        <h1>Mampf</h1>
        <p className="error">{message}</p>
        <button className="primary" type="button" onClick={retry} disabled={isPending}>
          {isPending ? "Retrying…" : "Try again"}
        </button>
      </div>
    </main>
  );
}
