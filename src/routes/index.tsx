import { useAtom, useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useForm } from "@tanstack/react-form";
import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { DateTime, Exit, Option, Schema } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import type { ReactNode } from "react";
import { MampfApi, ResultError, feedingsAtom, pumpingsAtom } from "../client/rpc";
import { isAuthed } from "../server/api";
import type { PumpSide } from "../shared/api";

const Tab = Schema.Literals(["feeding", "pumping"]);
const TAB_LABELS = { feeding: "🍼 Feeding", pumping: "🥛 Pumping" } satisfies Record<
  typeof Tab.Type,
  string
>;

export const Route = createFileRoute("/")({
  // The active tab lives in the URL (?tab=pumping) so links are shareable.
  // Unknown values fall back to the default tab instead of erroring. The key
  // must be present (even as undefined) to override the raw parent search.
  validateSearch: (search: Record<string, unknown>): { tab?: typeof Tab.Type } => ({
    tab: Schema.is(Tab)(search.tab) ? search.tab : undefined,
  }),
  // The redirect is a UX gate; every RPC still enforces auth.
  beforeLoad: async () => {
    if (!(await isAuthed())) {
      throw redirect({ to: "/pin" });
    }
  },
  // Start both lists loading before render. On the server the router waits for
  // them and ships their settled state to the client (see `src/router.tsx`).
  loader: ({ context: { registry } }) => {
    registry.mount(feedingsAtom);
    registry.mount(pumpingsAtom);
  },
  component: Tracker,
});

function Tracker() {
  const router = useRouter();
  const logout = useAtomSet(MampfApi.mutation("Logout"), { mode: "promiseExit" });
  const { tab = "feeding" } = Route.useSearch();
  // Keep the hidden tab's list mounted so it stays warm and revalidates on focus.
  useAtomMount(feedingsAtom);
  useAtomMount(pumpingsAtom);

  return (
    <main className="page">
      <header className="header">
        <h1>Mampf</h1>
        <button
          type="button"
          className="signout"
          onClick={() =>
            void logout({ payload: undefined }).then((exit) => {
              if (Exit.isSuccess(exit)) void router.invalidate();
            })
          }
        >
          Sign out
        </button>
      </header>

      <nav className="tabs" role="tablist" aria-label="Tracker sections">
        {Tab.literals.map((t) => (
          <Link
            key={t}
            to="/"
            search={{ tab: t }}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "tab active" : "tab"}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </nav>

      {tab === "feeding" ? <FeedingTab /> : <PumpingTab />}
    </main>
  );
}

function FeedingTab() {
  const result = useAtomValue(feedingsAtom);
  const [addResult, add] = useAtom(MampfApi.mutation("AddFeeding"), { mode: "promiseExit" });
  const [deleteResult, remove] = useAtom(MampfApi.mutation("DeleteFeeding"), {
    mode: "promiseExit",
  });

  const defaults = () => ({ amountMl: 90, fedAt: nowLocal() });
  const form = useForm({
    defaultValues: defaults(),
    onSubmit: async ({ value }) => {
      const exit = await add({
        payload: { amountMl: value.amountMl, fedAt: DateTime.makeUnsafe(value.fedAt) },
        reactivityKeys: ["feedings"],
      });
      if (Exit.isSuccess(exit)) form.reset(defaults());
    },
  });

  const feedings = Option.getOrUndefined(AsyncResult.value(result));
  const days = feedings && groupByDay(feedings, (f) => f.fedAt);
  const today = days?.find((d) => d.key === dayKey(DateTime.nowUnsafe()));
  const last = feedings?.[0];

  return (
    <>
      <section className="stats">
        <Stat value={feedings && `${today?.totalMl ?? 0} ml`} label="today" />
        <Stat value={feedings && (last ? timeAgo(last.fedAt) : "—")} label="last feed" />
        <Stat value={feedings?.length} label="entries (7 d)" />
      </section>

      <form className="card form" onSubmit={submit(form)}>
        <div className="form-row">
          <form.Field
            name="amountMl"
            children={(field) => (
              <Select
                label="Amount (ml)"
                unit="ml"
                max={1000}
                value={field.state.value}
                onChange={field.handleChange}
              />
            )}
          />
          <form.Field
            name="fedAt"
            children={(field) => (
              <TimeField value={field.state.value} onChange={field.handleChange} />
            )}
          />
        </div>
        <ResultError result={addResult} />
        <button className="primary" type="submit" disabled={addResult.waiting}>
          {addResult.waiting ? "Saving…" : "Add feeding"}
        </button>
      </form>

      <ResultError result={deleteResult} />
      <ResultError result={result} />

      <History
        days={days}
        empty="No feedings logged yet — add the first one above. 🍼"
        at={(f) => f.fedAt}
        busy={deleteResult.waiting}
        onDelete={(id) => void remove({ payload: { id }, reactivityKeys: ["feedings"] })}
      />
    </>
  );
}

const SIDES: ReadonlyArray<readonly [PumpSide, string]> = [
  ["left", "Left"],
  ["both", "Both"],
  ["right", "Right"],
];
const sideLabel = (side: PumpSide) => SIDES.find(([s]) => s === side)?.[1];

function PumpingTab() {
  const result = useAtomValue(pumpingsAtom);
  const [addResult, add] = useAtom(MampfApi.mutation("AddPumping"), { mode: "promiseExit" });
  const [deleteResult, remove] = useAtom(MampfApi.mutation("DeletePumping"), {
    mode: "promiseExit",
  });

  const defaults = () => ({
    side: "both" as PumpSide,
    durationMin: 15,
    amountMl: 60,
    pumpedAt: nowLocal(),
  });
  const form = useForm({
    defaultValues: defaults(),
    onSubmit: async ({ value }) => {
      const exit = await add({
        payload: { ...value, pumpedAt: DateTime.makeUnsafe(value.pumpedAt) },
        reactivityKeys: ["pumpings"],
      });
      if (Exit.isSuccess(exit)) form.reset(defaults());
    },
  });

  const pumpings = Option.getOrUndefined(AsyncResult.value(result));
  const days = pumpings && groupByDay(pumpings, (p) => p.pumpedAt);
  const today = days?.find((d) => d.key === dayKey(DateTime.nowUnsafe()));
  const todayMinutes = today?.entries.reduce((sum, p) => sum + p.durationMin, 0) ?? 0;
  const last = pumpings?.[0];

  return (
    <>
      <section className="stats">
        <Stat value={pumpings && `${today?.totalMl ?? 0} ml`} label="pumped today" />
        <Stat value={pumpings && `${todayMinutes} min`} label="pumping today" />
        <Stat value={pumpings && (last ? timeAgo(last.pumpedAt) : "—")} label="last pump" />
      </section>

      <form className="card form" onSubmit={submit(form)}>
        <form.Field
          name="side"
          children={(field) => (
            <div className="field">
              <span>Side</span>
              <div className="segmented" role="radiogroup" aria-label="Pumping side">
                {SIDES.map(([side, label]) => (
                  <button
                    key={side}
                    type="button"
                    role="radio"
                    aria-checked={field.state.value === side}
                    className={field.state.value === side ? "active" : ""}
                    onClick={() => field.handleChange(side)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        />
        <div className="form-row">
          <form.Field
            name="durationMin"
            children={(field) => (
              <Select
                label="Duration (min)"
                unit="min"
                max={60}
                value={field.state.value}
                onChange={field.handleChange}
              />
            )}
          />
          <form.Field
            name="amountMl"
            children={(field) => (
              <Select
                label="Amount (ml)"
                unit="ml"
                max={1000}
                value={field.state.value}
                onChange={field.handleChange}
              />
            )}
          />
        </div>
        <form.Field
          name="pumpedAt"
          children={(field) => (
            <TimeField value={field.state.value} onChange={field.handleChange} />
          )}
        />
        <ResultError result={addResult} />
        <button className="primary" type="submit" disabled={addResult.waiting}>
          {addResult.waiting ? "Saving…" : "Add pumping session"}
        </button>
      </form>

      <ResultError result={deleteResult} />
      <ResultError result={result} />

      <History
        days={days}
        empty="No pumping sessions logged yet — add the first one above. 🥛"
        at={(p) => p.pumpedAt}
        detail={(p) => `${sideLabel(p.side)} · ${p.durationMin} min`}
        busy={deleteResult.waiting}
        onDelete={(id) => void remove({ payload: { id }, reactivityKeys: ["pumpings"] })}
      />
    </>
  );
}

// --- Shared UI ---------------------------------------------------------------

/** Hand the (browser-validated) submit event to TanStack Form. */
const submit = (form: { handleSubmit: () => Promise<void> }) => (e: React.FormEvent) => {
  e.preventDefault();
  void form.handleSubmit();
};

function Stat({ value, label }: { value: ReactNode | undefined; label: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value ?? "…"}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

/** Options 5..max in steps of 5. */
function Select(props: {
  label: string;
  unit: string;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(e) => props.onChange(Number(e.target.value))}>
        {Array.from({ length: props.max / 5 }, (_, i) => (i + 1) * 5).map((n) => (
          <option key={n} value={n}>
            {n} {props.unit}
          </option>
        ))}
      </select>
    </label>
  );
}

function TimeField(props: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>Time</span>
      <input
        type="datetime-local"
        required
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

function History<T extends { readonly id: string; readonly amountMl: number }>(props: {
  days: ReadonlyArray<Day<T>> | undefined;
  empty: string;
  at: (entry: T) => DateTime.Utc;
  detail?: (entry: T) => ReactNode;
  busy: boolean;
  onDelete: (id: T["id"]) => void;
}) {
  if (!props.days) return <p className="empty">Loading…</p>;
  if (props.days.length === 0) return <p className="empty">{props.empty}</p>;
  return (
    <section className="history">
      {props.days.map((day) => (
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
                <span className="entry-time">{formatTime(props.at(entry))}</span>
                <span className="entry-amount">
                  {entry.amountMl} ml
                  {props.detail && <span className="entry-detail">{props.detail(entry)}</span>}
                </span>
                <button
                  type="button"
                  className="delete"
                  aria-label={`Delete entry at ${formatTime(props.at(entry))}`}
                  disabled={props.busy}
                  onClick={() => props.onDelete(entry.id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

// --- Local time helpers ------------------------------------------------------
// Feedings are stored in UTC; the UI groups and displays them in the device's
// local time zone, so both parents see "today" correctly on their own phones.

/** Local "YYYY-MM-DDTHH:mm" for `<input type="datetime-local">`. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

const nowLocal = () => toLocalInput(new Date());
const dayKey = (at: DateTime.Utc) => toLocalInput(DateTime.toDate(at)).slice(0, 10);
const formatTime = (at: DateTime.Utc) =>
  DateTime.toDate(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

interface Day<T> {
  readonly key: string;
  readonly label: string;
  readonly entries: Array<T>;
  totalMl: number;
}

function groupByDay<T extends { readonly amountMl: number }>(
  entries: ReadonlyArray<T>,
  at: (entry: T) => DateTime.Utc,
): Array<Day<T>> {
  const now = DateTime.nowUnsafe();
  const today = dayKey(now);
  const yesterday = dayKey(DateTime.subtract(now, { days: 1 }));
  const days = new Map<string, Day<T>>();
  for (const entry of entries) {
    const date = DateTime.toDate(at(entry));
    const key = dayKey(at(entry));
    const day = days.get(key) ?? {
      key,
      label:
        key === today
          ? "Today"
          : key === yesterday
            ? "Yesterday"
            : date.toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              }),
      entries: [],
      totalMl: 0,
    };
    day.entries.push(entry);
    day.totalMl += entry.amountMl;
    days.set(key, day);
  }
  return [...days.values()].sort((a, b) => b.key.localeCompare(a.key));
}

function timeAgo(at: DateTime.Utc): string {
  const minutes = Math.max(0, Math.round((Date.now() - DateTime.toEpochMillis(at)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest > 0 ? `${hours} h ${rest} min ago` : `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
