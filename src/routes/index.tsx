import { RegistryProvider, useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { Option, Schema } from "effect";
import {
  addFeedingAtom,
  addPumpingAtom,
  deleteFeedingAtom,
  deletePumpingAtom,
  feedingsAtom,
  logoutAtom,
  pumpingsAtom,
} from "../client/atoms";
import { loadFeedings, loadPumpings } from "../client/workflows";
import { isAuthed } from "../server/api";
import type { ApiErrorData } from "../shared/api";
import type { FeedingView } from "../server/feedings";
import type { PumpSide, PumpingView } from "../server/pumpings";

export const Route = createFileRoute("/")({
  // The active tab lives in the URL (?tab=pumping) so links are shareable and
  // it survives a reload. Validated with an Effect schema; an invalid value is
  // overridden with undefined so the default tab applies. (Router merges the
  // validated search over the raw one, so the key must be reset explicitly.)
  validateSearch: (search: Record<string, unknown>): TabSearch => {
    const result = Schema.decodeUnknownResult(tabSearchSchema)(search);
    return result._tag === "Success" ? result.success : { tab: undefined };
  },
  // The redirect is a UX gate; every server function still enforces auth.
  beforeLoad: async () => {
    if (!(await isAuthed())) {
      throw redirect({ to: "/pin" });
    }
  },
  // Fetches initial list data so the server render (and blocking client
  // navigations) can paint real content. The data is only a seed — after
  // hydration the query atoms below own all fetching and revalidation.
  loader: async () => ({
    feedings: await loadFeedings(),
    pumpings: await loadPumpings(),
  }),
  // A per-request Atom registry keeps the query/mutation atoms request-safe
  // during SSR. The loader data seeds the query atoms, so the first paint has
  // data; `Atom.swr` then handles focus revalidation and staleness.
  component: IndexPage,
});

function IndexPage() {
  const { feedings, pumpings } = Route.useLoaderData();
  const seededAt = Date.now();
  return (
    <RegistryProvider
      initialValues={[
        [feedingsAtom, AsyncResult.success(feedings, { timestamp: seededAt })],
        [pumpingsAtom, AsyncResult.success(pumpings, { timestamp: seededAt })],
      ]}
    >
      <Tracker />
    </RegistryProvider>
  );
}

/** Local "YYYY-MM-DDTHH:mm" for `<input type="datetime-local">`. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

interface DayGroup<T> {
  readonly key: string;
  readonly label: string;
  entries: Array<T>;
  totalMl: number;
}

interface EntryBase {
  readonly id: string;
  readonly amountMl: number;
}

function groupByDay<T extends EntryBase>(
  entries: Array<T>,
  at: (entry: T) => string,
): Array<DayGroup<T>> {
  const days = new Map<string, DayGroup<T>>();
  const dayFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  for (const entry of entries) {
    const date = new Date(at(entry));
    const key = toLocalInputValue(date).slice(0, 10);
    const today = toLocalInputValue(new Date()).slice(0, 10);
    const yesterday = toLocalInputValue(new Date(Date.now() - 24 * 60 * 60 * 1000)).slice(0, 10);
    const label =
      key === today ? "Today" : key === yesterday ? "Yesterday" : dayFormatter.format(date);

    let group = days.get(key);
    if (!group) {
      group = { key, label, entries: [], totalMl: 0 };
      days.set(key, group);
    }
    group.entries.push(entry);
    group.totalMl = group.totalMl + entry.amountMl;
  }

  return [...days.values()].sort((a, b) => b.key.localeCompare(a.key));
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest > 0 ? `${hours} h ${rest} min ago` : `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

const SIDE_LABELS: Record<PumpSide, string> = {
  left: "Left",
  right: "Right",
  both: "Both",
};

/**
 * Renders the lifecycle of a mutation atom: typed errors with their message,
 * defects (unexpected bugs) generically. Waiting/success render nothing.
 */
function WorkflowStatus({ result }: { result: AsyncResult.AsyncResult<unknown, ApiErrorData> }) {
  return AsyncResult.matchWithWaiting(result, {
    onWaiting: () => null,
    onSuccess: () => null,
    onError: (error) => <p className="error">{error.message}</p>,
    onDefect: () => <p className="error">Something went wrong. Please try again.</p>,
  });
}

const TABS = ["feeding", "pumping"] as const;

type Tab = (typeof TABS)[number];

/** Search params for the index route: `?tab=pumping`. */
const tabSearchSchema = Schema.Struct({
  tab: Schema.optional(Schema.Literals(TABS)),
});

type TabSearch = Schema.Schema.Type<typeof tabSearchSchema>;

/**
 * The latest data carried by a query atom result: the current success value, or
 * the previous success while a refresh is in flight / has failed — so stale
 * data stays visible (stale-while-revalidate) instead of the list collapsing
 * into a loading state.
 */
function latestEntries<A>(
  result: AsyncResult.AsyncResult<Array<A>, ApiErrorData>,
): Array<A> | undefined {
  if (result._tag === "Success") return result.value;
  if (result._tag === "Failure" && Option.isSome(result.previousSuccess)) {
    return result.previousSuccess.value.value;
  }
  return undefined;
}

function Tracker() {
  const router = useRouter();
  const [, runLogout] = useAtom(logoutAtom, { mode: "promiseExit" });
  // Both query atoms stay mounted so the hidden tab's data stays warm and
  // participates in focus revalidation.
  const feedings = useAtomValue(feedingsAtom);
  const pumpings = useAtomValue(pumpingsAtom);
  const { tab: tabParam } = Route.useSearch();
  const tab: Tab = tabParam ?? "feeding";
  const setTab = (tab: Tab) => {
    void router.navigate({ to: ".", search: { tab } });
  };

  return (
    <main className="page">
      <header className="header">
        <h1>Mampf</h1>
        <button
          type="button"
          className="signout"
          aria-label="Sign out"
          onClick={() => {
            void runLogout(undefined).then((exit) => {
              if (exit._tag === "Success") void router.invalidate();
            });
          }}
        >
          Sign out
        </button>
      </header>

      <nav className="tabs" role="tablist" aria-label="Tracker sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "feeding"}
          className={tab === "feeding" ? "tab active" : "tab"}
          onClick={() => setTab("feeding")}
        >
          🍼 Feeding
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "pumping"}
          className={tab === "pumping" ? "tab active" : "tab"}
          onClick={() => setTab("pumping")}
        >
          🥛 Pumping
        </button>
      </nav>

      {tab === "feeding" ? <FeedingTab result={feedings} /> : <PumpingTab result={pumpings} />}
    </main>
  );
}

/** Option values 5..max in steps of 5, for the amount/duration selects. */
const step5Options = (max: number) =>
  Array.from({ length: Math.floor(max / 5) }, (_, i) => (i + 1) * 5);

function FeedingTab({
  result,
}: {
  result: AsyncResult.AsyncResult<Array<FeedingView>, ApiErrorData>;
}) {
  const refreshFeedings = useAtomRefresh(feedingsAtom);
  const [addResult, runAdd] = useAtom(addFeedingAtom, { mode: "promiseExit" });
  const [deleteResult, runDelete] = useAtom(deleteFeedingAtom, { mode: "promiseExit" });
  const busy = addResult.waiting || deleteResult.waiting;

  const form = useForm({
    defaultValues: {
      amount: "90",
      fedAt: toLocalInputValue(new Date()),
    },
    onSubmit: ({ value }) => {
      void runAdd({
        amountMl: Math.round(Number(value.amount)),
        // `new Date(...)` interprets the datetime-local value in the user's
        // timezone; we store the instant as UTC ISO.
        fedAt: new Date(value.fedAt).toISOString(),
      }).then((exit) => {
        if (exit._tag === "Success") {
          // Reset the whole form (defaults + cleared validation) and bump the
          // time field to "now" for the next entry.
          form.reset();
          form.setFieldValue("fedAt", toLocalInputValue(new Date()));
          refreshFeedings();
        }
      });
    },
  });

  const isSubmitting = addResult.waiting;

  // `undefined` while the first fetch is in flight (or has failed without any
  // earlier data); defined (possibly stale) once data has arrived.
  const feedings = latestEntries(result);
  const days = groupByDay(feedings ?? [], (f) => f.fedAt);
  const todayKey = toLocalInputValue(new Date()).slice(0, 10);
  const todayTotal = days.find((d) => d.key === todayKey)?.totalMl ?? 0;
  const lastFeeding = feedings?.[0];

  const remove = (id: string) => {
    void runDelete(id).then((exit) => {
      if (exit._tag === "Success") refreshFeedings();
    });
  };

  return (
    <>
      <section className="stats">
        <div className="stat">
          <span className="stat-value">{feedings === undefined ? "…" : `${todayTotal} ml`}</span>
          <span className="stat-label">today</span>
        </div>
        <div className="stat">
          <span className="stat-value">{lastFeeding ? timeAgo(lastFeeding.fedAt) : "—"}</span>
          <span className="stat-label">last feed</span>
        </div>
        <div className="stat">
          <span className="stat-value">{feedings?.length ?? "…"}</span>
          <span className="stat-label">entries (7 d)</span>
        </div>
      </section>

      <form
        className="card form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <div className="form-row">
          <form.Field
            name="amount"
            validators={{
              onChange: ({ value }) => {
                const ml = Number(value);
                if (!Number.isFinite(ml) || ml <= 0) return "Please enter a valid amount in ml.";
                if (ml > 1000) return "Amount must be at most 1000 ml.";
                return undefined;
              },
            }}
            children={(field) => (
              <label className="field">
                <span>Amount (ml)</span>
                <select
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                >
                  {step5Options(1000).map((ml) => (
                    <option key={ml} value={String(ml)}>
                      {ml} ml
                    </option>
                  ))}
                </select>
                {field.state.meta.errors.length > 0 && (
                  <span className="error">{field.state.meta.errors.join(", ")}</span>
                )}
              </label>
            )}
          />
          <form.Field
            name="fedAt"
            validators={{
              onChange: ({ value }) => (value ? undefined : "Please pick a time."),
            }}
            children={(field) => (
              <label className="field">
                <span>Time</span>
                <input
                  type="datetime-local"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.length > 0 && (
                  <span className="error">{field.state.meta.errors.join(", ")}</span>
                )}
              </label>
            )}
          />
        </div>

        {AsyncResult.matchWithWaiting(addResult, {
          onWaiting: () => null,
          onSuccess: () => null,
          onError: (error) => <p className="error">{error.message}</p>,
          onDefect: () => <p className="error">Something went wrong. Please try again.</p>,
        })}

        <button className="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Add feeding"}
        </button>
      </form>

      <WorkflowStatus result={deleteResult} />

      {AsyncResult.matchWithWaiting(result, {
        onWaiting: () => null,
        onSuccess: () => null,
        onError: (error) => <p className="error">{error.message}</p>,
        onDefect: () => <p className="error">Something went wrong. Please try again.</p>,
      })}

      <section className="history">
        {feedings === undefined ? (
          <p className="empty">Loading…</p>
        ) : days.length === 0 ? (
          <p className="empty">No feedings logged yet — add the first one above. 🍼</p>
        ) : (
          days.map((day) => (
            <div key={day.key} className="card day">
              <div className="day-header">
                <h2>{day.label}</h2>
                <span className="day-total">
                  {day.entries.length} · {day.totalMl} ml
                </span>
              </div>
              <ul>
                {day.entries.map((entry) => (
                  <li key={entry.id}>
                    <span className="entry-time">{formatTime(entry.fedAt)}</span>
                    <span className="entry-amount">{entry.amountMl} ml</span>
                    <button
                      type="button"
                      className="delete"
                      aria-label={`Delete feeding at ${formatTime(entry.fedAt)}`}
                      disabled={busy}
                      onClick={() => remove(entry.id)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </>
  );
}

function PumpingTab({
  result,
}: {
  result: AsyncResult.AsyncResult<Array<PumpingView>, ApiErrorData>;
}) {
  const refreshPumpings = useAtomRefresh(pumpingsAtom);
  const [addResult, runAdd] = useAtom(addPumpingAtom, { mode: "promiseExit" });
  const [deleteResult, runDelete] = useAtom(deletePumpingAtom, { mode: "promiseExit" });
  const busy = addResult.waiting || deleteResult.waiting;

  const form = useForm({
    defaultValues: {
      side: "both" as PumpSide,
      duration: "15",
      amount: "60",
      pumpedAt: toLocalInputValue(new Date()),
    },
    onSubmit: ({ value }) => {
      void runAdd({
        side: value.side,
        durationMin: Math.round(Number(value.duration)),
        amountMl: Math.round(Number(value.amount)),
        pumpedAt: new Date(value.pumpedAt).toISOString(),
      }).then((exit) => {
        if (exit._tag === "Success") {
          // Reset the whole form (defaults + cleared validation) and bump the
          // time field to "now" for the next entry.
          form.reset();
          form.setFieldValue("pumpedAt", toLocalInputValue(new Date()));
          refreshPumpings();
        }
      });
    },
  });

  const isSubmitting = addResult.waiting;

  // `undefined` while the first fetch is in flight (or has failed without any
  // earlier data); defined (possibly stale) once data has arrived.
  const pumpings = latestEntries(result);
  const days = groupByDay(pumpings ?? [], (p) => p.pumpedAt);
  const todayKey = toLocalInputValue(new Date()).slice(0, 10);
  const today = days.find((d) => d.key === todayKey);
  const todayTotal = today?.totalMl ?? 0;
  const todayMinutes = today?.entries.reduce((sum, p) => sum + p.durationMin, 0) ?? 0;
  const lastPumping = pumpings?.[0];

  const remove = (id: string) => {
    void runDelete(id).then((exit) => {
      if (exit._tag === "Success") refreshPumpings();
    });
  };

  return (
    <>
      <section className="stats">
        <div className="stat">
          <span className="stat-value">{pumpings === undefined ? "…" : `${todayTotal} ml`}</span>
          <span className="stat-label">pumped today</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {pumpings === undefined ? "…" : `${todayMinutes} min`}
          </span>
          <span className="stat-label">pumping today</span>
        </div>
        <div className="stat">
          <span className="stat-value">{lastPumping ? timeAgo(lastPumping.pumpedAt) : "—"}</span>
          <span className="stat-label">last pump</span>
        </div>
      </section>

      <form
        className="card form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <form.Field
          name="side"
          children={(field) => (
            <div className="field">
              <span>Side</span>
              <div className="segmented" role="radiogroup" aria-label="Pumping side">
                {(["left", "both", "right"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    role="radio"
                    aria-checked={field.state.value === side}
                    className={field.state.value === side ? "active" : ""}
                    onClick={() => field.handleChange(side)}
                  >
                    {SIDE_LABELS[side]}
                  </button>
                ))}
              </div>
            </div>
          )}
        />

        <div className="form-row">
          <form.Field
            name="duration"
            validators={{
              onChange: ({ value }) => {
                const min = Number(value);
                if (!Number.isFinite(min) || min <= 0) return "Enter a valid duration in minutes.";
                if (min > 60) return "Duration must be at most 60 min.";
                return undefined;
              },
            }}
            children={(field) => (
              <label className="field">
                <span>Duration (min)</span>
                <select
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                >
                  {step5Options(60).map((min) => (
                    <option key={min} value={String(min)}>
                      {min} min
                    </option>
                  ))}
                </select>
                {field.state.meta.errors.length > 0 && (
                  <span className="error">{field.state.meta.errors.join(", ")}</span>
                )}
              </label>
            )}
          />
          <form.Field
            name="amount"
            validators={{
              onChange: ({ value }) => {
                const ml = Number(value);
                if (!Number.isFinite(ml) || ml <= 0) return "Enter a valid amount in ml.";
                if (ml > 1000) return "Amount must be at most 1000 ml.";
                return undefined;
              },
            }}
            children={(field) => (
              <label className="field">
                <span>Amount (ml)</span>
                <select
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                >
                  {step5Options(1000).map((ml) => (
                    <option key={ml} value={String(ml)}>
                      {ml} ml
                    </option>
                  ))}
                </select>
                {field.state.meta.errors.length > 0 && (
                  <span className="error">{field.state.meta.errors.join(", ")}</span>
                )}
              </label>
            )}
          />
        </div>

        <form.Field
          name="pumpedAt"
          validators={{
            onChange: ({ value }) => (value ? undefined : "Please pick a time."),
          }}
          children={(field) => (
            <label className="field">
              <span>Time</span>
              <input
                type="datetime-local"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors.length > 0 && (
                <span className="error">{field.state.meta.errors.join(", ")}</span>
              )}
            </label>
          )}
        />

        {AsyncResult.matchWithWaiting(addResult, {
          onWaiting: () => null,
          onSuccess: () => null,
          onError: (error) => <p className="error">{error.message}</p>,
          onDefect: () => <p className="error">Something went wrong. Please try again.</p>,
        })}

        <button className="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Add pumping session"}
        </button>
      </form>

      <WorkflowStatus result={deleteResult} />

      {AsyncResult.matchWithWaiting(result, {
        onWaiting: () => null,
        onSuccess: () => null,
        onError: (error) => <p className="error">{error.message}</p>,
        onDefect: () => <p className="error">Something went wrong. Please try again.</p>,
      })}

      <section className="history">
        {pumpings === undefined ? (
          <p className="empty">Loading…</p>
        ) : days.length === 0 ? (
          <p className="empty">No pumping sessions logged yet — add the first one above. 🥛</p>
        ) : (
          days.map((day) => (
            <div key={day.key} className="card day">
              <div className="day-header">
                <h2>{day.label}</h2>
                <span className="day-total">
                  {day.entries.length} · {day.totalMl} ml
                </span>
              </div>
              <ul>
                {day.entries.map((entry) => (
                  <li key={entry.id}>
                    <span className="entry-time">{formatTime(entry.pumpedAt)}</span>
                    <span className="entry-amount">
                      {entry.amountMl} ml
                      <span className="entry-detail">
                        {SIDE_LABELS[entry.side]} · {entry.durationMin} min
                      </span>
                    </span>
                    <button
                      type="button"
                      className="delete"
                      aria-label={`Delete pumping session at ${formatTime(entry.pumpedAt)}`}
                      disabled={busy}
                      onClick={() => remove(entry.id)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </>
  );
}
