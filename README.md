# Mampf 🍼

A feeding tracker for your little one: log the amount of milk (ml) and the time
of each feed, and see when and how much she ate.

Built with **TanStack Start** (React), **Effect v4** and **Cloudflare Workers**
with **D1** (SQLite) as persistent storage.

## Stack

- **TanStack Start** — full-stack React with server functions (`src/server/api.ts`)
- **Effect v4** — domain logic as services & layers (`src/server/feedings.ts`),
  input validation with `Schema`, SQL via `@effect/sql-d1`
- **Cloudflare D1** — the `DB` binding in `wrangler.jsonc`, migrated with
  `wrangler d1 migrations` (`migrations/`)
- Local dev uses the same D1 schema via miniflare (`vite dev`)

## Development

```sh
pnpm install
pnpm cf-typegen        # regenerate worker-configuration.d.ts after wrangler.jsonc changes
pnpm db:migrate:local  # apply migrations to the local D1 database
pnpm dev               # http://localhost:5173
```

The dev command in `.amp/services.yaml` applies local migrations before
starting Vite automatically.

## Deploy to Cloudflare

1. Create the database once:

   ```sh
   npx wrangler d1 create mampf-db
   ```

2. Put the returned `database_id` into `wrangler.jsonc` (replace the
   placeholder UUID).

3. Deploy:

   ```sh
   pnpm db:migrate:remote  # apply migrations to the real database
   pnpm deploy             # build + wrangler deploy
   ```

## Structure

```
src/
├── routes/index.tsx      # UI: add form, quick amounts, per-day history
├── routes/__root.tsx     # HTML shell
├── server/api.ts         # TanStack Start server functions (HTTP boundary)
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
