import { useForm, useSelector } from "@tanstack/react-form";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import {
  addFeeding,
  addPumping,
  deleteFeeding,
  deletePumping,
  isAuthed,
  listFeedings,
  listPumpings,
  login,
  logout,
} from "../server/api";
import type { FeedingView } from "../server/feedings";
import type { PumpSide, PumpingView } from "../server/pumpings";

export const Route = createFileRoute("/")({
  loader: async () => {
    const authed = await isAuthed();
    // Entries are only loaded for signed-in visitors.
    return {
      authed,
      feedings: authed ? await listFeedings() : [],
      pumpings: authed ? await listPumpings() : [],
    };
  },
  component: Home,
});

function PinGate() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { pin: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const ok = await login({ data: { pin: value.pin } });
        if (ok) {
          await router.invalidate();
        } else {
          setError("Wrong PIN.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    },
  });

  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

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
        <span className="pin-logo">🍼</span>
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
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
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

function Home() {
  const { authed, feedings, pumpings } = Route.useLoaderData();
  if (!authed) return <PinGate />;
  return <Tracker feedings={feedings} pumpings={pumpings} />;
}

type Tab = "feeding" | "pumping";

function Tracker({
  feedings,
  pumpings,
}: {
  feedings: Array<FeedingView>;
  pumpings: Array<PumpingView>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("feeding");

  return (
    <main className="page">
      <header className="header">
        <h1>Mampf</h1>
        <button
          type="button"
          className="signout"
          aria-label="Sign out"
          onClick={async () => {
            await logout();
            await router.invalidate();
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

      {tab === "feeding" ? <FeedingTab feedings={feedings} /> : <PumpingTab pumpings={pumpings} />}
    </main>
  );
}

function FeedingTab({ feedings }: { feedings: Array<FeedingView> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const form = useForm({
    defaultValues: {
      amount: "90",
      fedAt: toLocalInputValue(new Date()),
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        // `new Date(...)` interprets the datetime-local value in the user's
        // timezone; we store the instant as UTC ISO.
        await addFeeding({
          data: {
            amountMl: Math.round(Number(value.amount)),
            fedAt: new Date(value.fedAt).toISOString(),
          },
        });
        await router.invalidate();
        form.setFieldValue("fedAt", toLocalInputValue(new Date()));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    },
  });

  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

  const days = groupByDay(feedings, (f) => f.fedAt);
  const todayKey = toLocalInputValue(new Date()).slice(0, 10);
  const todayTotal = days.find((d) => d.key === todayKey)?.totalMl ?? 0;
  const lastFeeding = feedings[0];

  const remove = async (id: string) => {
    setDeleting(true);
    try {
      await deleteFeeding({ data: { id } });
      await router.invalidate();
    } finally {
      setDeleting(false);
    }
  };

  const applyQuickAmount = (ml: number) => {
    form.setFieldValue("amount", String(ml));
    form.setFieldValue("fedAt", toLocalInputValue(new Date()));
  };

  return (
    <>
      <section className="stats">
        <div className="stat">
          <span className="stat-value">{todayTotal} ml</span>
          <span className="stat-label">today</span>
        </div>
        <div className="stat">
          <span className="stat-value">{lastFeeding ? timeAgo(lastFeeding.fedAt) : "—"}</span>
          <span className="stat-label">last feed</span>
        </div>
        <div className="stat">
          <span className="stat-value">{feedings.length}</span>
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
                if (ml > 2000) return "Amount must be at most 2000 ml.";
                return undefined;
              },
            }}
            children={(field) => (
              <label className="field">
                <span>Amount (ml)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={2000}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
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

        <div className="quick">
          {[30, 60, 90, 120, 150].map((ml) => (
            <button key={ml} type="button" onClick={() => applyQuickAmount(ml)}>
              +{ml}
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}

        <button className="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Add feeding"}
        </button>
      </form>

      <section className="history">
        {days.length === 0 ? (
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
                      disabled={deleting || isSubmitting}
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

function PumpingTab({ pumpings }: { pumpings: Array<PumpingView> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const form = useForm({
    defaultValues: {
      side: "both" as PumpSide,
      duration: "15",
      amount: "",
      pumpedAt: toLocalInputValue(new Date()),
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        await addPumping({
          data: {
            side: value.side,
            durationMin: Math.round(Number(value.duration)),
            amountMl: Math.round(Number(value.amount)),
            pumpedAt: new Date(value.pumpedAt).toISOString(),
          },
        });
        await router.invalidate();
        form.setFieldValue("amount", "");
        form.setFieldValue("pumpedAt", toLocalInputValue(new Date()));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    },
  });

  const isSubmitting = useSelector(form.store, (state) => state.isSubmitting);

  const days = groupByDay(pumpings, (p) => p.pumpedAt);
  const todayKey = toLocalInputValue(new Date()).slice(0, 10);
  const today = days.find((d) => d.key === todayKey);
  const todayTotal = today?.totalMl ?? 0;
  const todayMinutes = today?.entries.reduce((sum, p) => sum + p.durationMin, 0) ?? 0;
  const lastPumping = pumpings[0];

  const remove = async (id: string) => {
    setDeleting(true);
    try {
      await deletePumping({ data: { id } });
      await router.invalidate();
    } finally {
      setDeleting(false);
    }
  };

  const applyQuickDuration = (min: number) => {
    form.setFieldValue("duration", String(min));
    form.setFieldValue("pumpedAt", toLocalInputValue(new Date()));
  };

  return (
    <>
      <section className="stats">
        <div className="stat">
          <span className="stat-value">{todayTotal} ml</span>
          <span className="stat-label">pumped today</span>
        </div>
        <div className="stat">
          <span className="stat-value">{todayMinutes} min</span>
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
                if (min > 240) return "Duration must be at most 240 min.";
                return undefined;
              },
            }}
            children={(field) => (
              <label className="field">
                <span>Duration (min)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={240}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
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
                if (ml > 2000) return "Amount must be at most 2000 ml.";
                return undefined;
              },
            }}
            children={(field) => (
              <label className="field">
                <span>Amount (ml)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={2000}
                  placeholder="Output"
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

        <div className="quick">
          {[5, 10, 15, 20, 30].map((min) => (
            <button key={min} type="button" onClick={() => applyQuickDuration(min)}>
              {min} min
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}

        <button className="primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Add pumping session"}
        </button>
      </form>

      <section className="history">
        {days.length === 0 ? (
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
                      disabled={deleting || isSubmitting}
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
