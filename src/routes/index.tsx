import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { DateTime, Option, Schema } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import {
  addFeedingAtom,
  addPumpingAtom,
  deleteFeedingAtom,
  deletePumpingAtom,
  feedingsAtom,
  logoutAtom,
  pumpingsAtom,
} from "../client/rpc";
import { ResultError, type RpcError } from "../client/rpc";
import { prefetchAtoms } from "../client/prefetch";
import { isAuthed } from "../server/api";
import { MAX_AMOUNT_ML, MAX_PUMP_DURATION_MIN } from "../shared/domain";
import type { FeedingView, PumpSide, PumpingView } from "../shared/domain";

export const Route = createFileRoute("/")({
  // The active tab lives in the URL (?tab=pumping) so links are shareable and
  // it survives a reload. Validated with an Effect schema; an invalid value is
  // overridden with undefined so the default tab applies. (Router merges the
  // validated search over the raw one, so the key must be reset explicitly.)
  validateSearch: (search: Record<string, unknown>): TabSearch => {
    const result = Schema.decodeUnknownResult(tabSearchSchema)(search);
    return result._tag === "Success" ? result.success : { tab: undefined };
  },
  // The redirect is a UX gate; every RPC still enforces auth.
  beforeLoad: async () => {
    if (!(await isAuthed())) {
      throw redirect({ to: "/pin" });
    }
  },
  // Temporary subscriptions settle both lists, then React owns their mounts.
  loader: ({ context: { registry }, abortController }) =>
    prefetchAtoms(registry, [feedingsAtom, pumpingsAtom], abortController.signal),
  component: Tracker,
});

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
  entries: ReadonlyArray<T>,
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

const TABS = ["feeding", "pumping"] as const;

type Tab = (typeof TABS)[number];

/** Search params for the index route: `?tab=pumping`. */
const tabSearchSchema = Schema.Struct({
  tab: Schema.optional(Schema.Literals(TABS)),
});

type TabSearch = Schema.Schema.Type<typeof tabSearchSchema>;

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
            void runLogout({ payload: undefined }).then((exit) => {
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
  result: AsyncResult.AsyncResult<ReadonlyArray<FeedingView>, RpcError>;
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
        payload: {
          amountMl: Math.round(Number(value.amount)),
          // `new Date(...)` interprets the datetime-local value in the user's
          // timezone; we store the instant as UTC ISO.
          fedAt: DateTime.fromDateUnsafe(new Date(value.fedAt)),
        },
        reactivityKeys: ["feedings"],
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

  // `AsyncResult.value` keeps the previous success visible while a refresh is
  // in flight or has failed (stale-while-revalidate): `undefined` only before
  // the first fetch arrives.
  const feedings = Option.getOrUndefined(AsyncResult.value(result));
  const days = groupByDay(feedings ?? [], (f) => f.fedAt);
  const todayKey = toLocalInputValue(new Date()).slice(0, 10);
  const todayTotal = days.find((d) => d.key === todayKey)?.totalMl ?? 0;
  const lastFeeding = feedings?.[0];

  const remove = (id: FeedingView["id"]) => {
    void runDelete({ payload: { id }, reactivityKeys: ["feedings"] }).then((exit) => {
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
            children={(field) => (
              <label className="field">
                <span>Amount (ml)</span>
                <select
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                >
                  {step5Options(MAX_AMOUNT_ML).map((ml) => (
                    <option key={ml} value={String(ml)}>
                      {ml} ml
                    </option>
                  ))}
                </select>
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

        <ResultError result={addResult} />

        <button className="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Add feeding"}
        </button>
      </form>

      <ResultError result={deleteResult} />

      <ResultError result={result} />

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
  result: AsyncResult.AsyncResult<ReadonlyArray<PumpingView>, RpcError>;
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
        payload: {
          side: value.side,
          durationMin: Math.round(Number(value.duration)),
          amountMl: Math.round(Number(value.amount)),
          pumpedAt: DateTime.fromDateUnsafe(new Date(value.pumpedAt)),
        },
        reactivityKeys: ["pumpings"],
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

  const pumpings = Option.getOrUndefined(AsyncResult.value(result));
  const days = groupByDay(pumpings ?? [], (p) => p.pumpedAt);
  const todayKey = toLocalInputValue(new Date()).slice(0, 10);
  const today = days.find((d) => d.key === todayKey);
  const todayTotal = today?.totalMl ?? 0;
  const todayMinutes = today?.entries.reduce((sum, p) => sum + p.durationMin, 0) ?? 0;
  const lastPumping = pumpings?.[0];

  const remove = (id: PumpingView["id"]) => {
    void runDelete({ payload: { id }, reactivityKeys: ["pumpings"] }).then((exit) => {
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
          <span className="stat-value">{pumpings === undefined ? "…" : `${todayMinutes} min`}</span>
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
            children={(field) => (
              <label className="field">
                <span>Duration (min)</span>
                <select
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                >
                  {step5Options(MAX_PUMP_DURATION_MIN).map((min) => (
                    <option key={min} value={String(min)}>
                      {min} min
                    </option>
                  ))}
                </select>
              </label>
            )}
          />
          <form.Field
            name="amount"
            children={(field) => (
              <label className="field">
                <span>Amount (ml)</span>
                <select
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                >
                  {step5Options(MAX_AMOUNT_ML).map((ml) => (
                    <option key={ml} value={String(ml)}>
                      {ml} ml
                    </option>
                  ))}
                </select>
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

        <ResultError result={addResult} />

        <button className="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Add pumping session"}
        </button>
      </form>

      <ResultError result={deleteResult} />

      <ResultError result={result} />

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
