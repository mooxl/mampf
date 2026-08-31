# Mampf 🍼

A feeding tracker for your little one: log the amount of milk (ml) and the time
of each feed, and see when and how much she ate.

Built with **TanStack Start** (React), **Effect v4** and **Cloudflare Workers**
with **D1** (SQLite) as persistent storage. Tooling (dev server, build, lint,
format, type check) runs through **Vite+** (`vp`).

## Stack

- **TanStack Start** — full-stack React with server functions (`src/server/api.ts`)
- **Effect v4** — domain logic as services & layers (`src/server/feedings.ts`),
  input validation with `Schema`, SQL via `@effect/sql-d1`
- **Cloudflare D1** — the `DB` binding in `wrangler.jsonc`, migrated with
  `wrangler d1 migrations` (`migrations/`)
- Local dev uses the same D1 schema via miniflare (`vp dev`)

## Development

```sh
vp install               # install dependencies (delegates to pnpm)
vp run cf-typegen        # regenerate worker-configuration.d.ts after wrangler.jsonc changes
vp run db:migrate:local  # apply migrations to the local D1 database
vp dev                   # dev server on http://localhost:5173
```

The dev command in `.amp/services.yaml` applies local migrations before
starting the dev server automatically.

## Vite+

Everyday commands go through `vp` (the Vite+ CLI):

```sh
vp install        # install dependencies (delegates to pnpm)
vp dev            # dev server
vp check          # format, type-aware lint, and type checks
vp check --fix    # auto-fix formatting and lint issues
vp build          # production build
vp run <script>   # run a script from package.json
```

Lint and formatting are configured in `vite.config.ts` (oxlint + oxfmt).

## Deploy to Cloudflare

1. Create the database once:

   ```sh
   vp exec wrangler d1 create mampf-db
   ```

2. Put the returned `database_id` into `wrangler.jsonc` (replace the
   placeholder UUID).

3. Set the shared family PIN as a secret:

   ```sh
   vp exec wrangler secret put PIN
   ```

4. Deploy:

   ```sh
   vp run db:migrate:remote  # apply migrations to the real database
   vp run deploy             # build + wrangler deploy
   ```

## Access protection

The app is protected by a single shared PIN that you both use:

- Locally, set it in `.dev.vars` (gitignored): `PIN=1234`
- In production, set it with `wrangler secret put PIN`
- After unlocking, a long-lived `httpOnly` cookie keeps you signed in
  (session token = salted SHA-256 of the PIN, so the cookie never
  contains the PIN itself)
- Every server function (list/add/delete) re-validates the cookie, and the
  loader never loads feedings for signed-out visitors
- "Sign out" clears the cookie

## Structure

```
src/
├── routes/index.tsx      # UI: PIN gate, add form, quick amounts, per-day history
├── routes/__root.tsx     # HTML shell
├── server/api.ts         # TanStack Start server functions (HTTP boundary)
├── server/auth.server.ts # Shared-PIN session handling (cookie + salted hash)
├── server/feedings.ts    # Effect domain: Feeding model + Feedings service
├── server/runtime.ts     # ManagedRuntime: layers + D1 binding wiring
└── styles.css
migrations/0001_feedings.sql
```

Notes:

- Feedings are stored in UTC; the UI groups them by the browser's local day,
  so both parents see "today" correctly on their own phones.
- All server input is validated with Effect `Schema` (amount 1–2000 ml,
  ISO timestamp) before it reaches the service layer.
