import { useRouter } from "@tanstack/react-router"
import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { addFeeding, deleteFeeding, isAuthed, listFeedings, login, logout } from "../server/api"
import type { FeedingView } from "../server/feedings"

export const Route = createFileRoute("/")({
  loader: async () => {
    const authed = await isAuthed()
    // Feedings are only loaded for signed-in visitors.
    return { authed, feedings: authed ? await listFeedings() : [] }
  },
  component: Home,
})

function PinGate() {
  const router = useRouter()
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const ok = await login({ data: { pin } })
      if (ok) {
        setPin("")
        await router.invalidate()
      } else {
        setError("Wrong PIN.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <form className="card form pin-gate" onSubmit={submit}>
        <span className="pin-logo">🍼</span>
        <h1>Mampf</h1>
        <label className="field">
          <span>Family PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  )
}

/** Local "YYYY-MM-DDTHH:mm" for `<input type="datetime-local">`. */
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

interface DayGroup {
  readonly key: string
  readonly label: string
  entries: Array<FeedingView>
  totalMl: number
}

function groupByDay(feedings: Array<FeedingView>): Array<DayGroup> {
  const days = new Map<string, DayGroup>()
  const dayFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  })

  for (const feeding of feedings) {
    const date = new Date(feeding.fedAt)
    const key = toLocalInputValue(date).slice(0, 10)
    const today = toLocalInputValue(new Date()).slice(0, 10)
    const yesterday = toLocalInputValue(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    ).slice(0, 10)
    const label =
      key === today ? "Today" : key === yesterday ? "Yesterday" : dayFormatter.format(date)

    let group = days.get(key)
    if (!group) {
      group = { key, label, entries: [], totalMl: 0 }
      days.set(key, group)
    }
    group.entries.push(feeding)
    group.totalMl = group.totalMl + feeding.amountMl
  }

  return [...days.values()].sort((a, b) => b.key.localeCompare(a.key))
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso))
}

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest > 0 ? `${hours} h ${rest} min ago` : `${hours} h ago`
  const days = Math.floor(hours / 24)
  return `${days} d ago`
}

function Home() {
  const { authed, feedings } = Route.useLoaderData()
  if (!authed) return <PinGate />
  return <Tracker feedings={feedings} />
}

function Tracker({ feedings }: { feedings: Array<FeedingView> }) {
  const router = useRouter()
  const [amount, setAmount] = useState("90")
  const [fedAt, setFedAt] = useState(() => toLocalInputValue(new Date()))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const days = groupByDay(feedings)
  const todayKey = toLocalInputValue(new Date()).slice(0, 10)
  const todayTotal = days.find((d) => d.key === todayKey)?.totalMl ?? 0
  const lastFeeding = feedings[0]

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const ml = Number(amount)
    if (!Number.isFinite(ml) || ml <= 0) {
      setError("Please enter a valid amount in ml.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      // `new Date(...)` interprets the datetime-local value in the user's
      // timezone; we store the instant as UTC ISO.
      await addFeeding({ data: { amountMl: Math.round(ml), fedAt: new Date(fedAt).toISOString() } })
      await router.invalidate()
      setFedAt(toLocalInputValue(new Date()))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await deleteFeeding({ data: { id } })
      await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  const applyQuickAmount = (ml: number) => {
    setAmount(String(ml))
    setFedAt(toLocalInputValue(new Date()))
  }

  return (
    <main className="page">
      <button
        type="button"
        className="signout"
        aria-label="Sign out"
        onClick={async () => {
          await logout()
          await router.invalidate()
        }}
      >
        Sign out
      </button>
      <header className="header">
        <span className="logo">🍼</span>
        <div>
          <h1>Mampf</h1>
          <p>Feeding tracker</p>
        </div>
      </header>

      <section className="stats">
        <div className="stat">
          <span className="stat-value">{todayTotal} ml</span>
          <span className="stat-label">today</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {lastFeeding ? timeAgo(lastFeeding.fedAt) : "—"}
          </span>
          <span className="stat-label">last feed</span>
        </div>
        <div className="stat">
          <span className="stat-value">{feedings.length}</span>
          <span className="stat-label">entries (7 d)</span>
        </div>
      </section>

      <form className="card form" onSubmit={submit}>
        <div className="form-row">
          <label className="field">
            <span>Amount (ml)</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={2000}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Time</span>
            <input
              type="datetime-local"
              value={fedAt}
              onChange={(e) => setFedAt(e.target.value)}
              required
            />
          </label>
        </div>

        <div className="quick">
          {[30, 60, 90, 120, 150].map((ml) => (
            <button key={ml} type="button" onClick={() => applyQuickAmount(ml)}>
              +{ml}
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Add feeding"}
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
    </main>
  )
}
