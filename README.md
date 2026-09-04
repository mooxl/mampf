# Mampf 🍼

A feeding tracker for your little one: log the amount of milk (ml) and the time
of each feed, and see when and how much she ate.

Built with **TanStack Start** (React), **Effect v4** and **Cloudflare Workers**
with **D1** (SQLite) as persistent storage. Tooling (dev server, build, lint,
format, type check) runs through **Vite+** (`vp`).

## Stack

- **TanStack Start** — React SSR/routing, plus a database-independent auth gate
- **Effect v4** — domain logic as services & layers (`src/server/feedings.ts`),
  shared Schema/RPC contracts, SQL via `@effect/sql-d1`, and Atom query state
- **Cloudflare D1** — the `DB` binding in `wrangler.jsonc`, migrated with
  `wrangler d1 migrations` (`migrations/`)

## Development

Create `.dev.vars` once (gitignored):

```sh
printf 'PIN=1234\nSESSION_SECRET=%s\n' "$(openssl rand -hex 32)" > .dev.vars
chmod 600 .dev.vars
```

Don't overwrite an existing secret unless you intend to sign out all local
sessions. Orb setup/resume generates missing local credentials automatically.

```sh
vp install               # install dependencies (delegates to pnpm)
vp run cf-typegen        # regenerate worker-configuration.d.ts after wrangler.jsonc changes
vp run db:migrate:local  # apply migrations to the local D1 database
vp dev                   # dev server on http://localhost:5173
```

The dev command in `.amp/services.yaml` applies local migrations before
starting the dev server automatically.

**Database caution:** `wrangler.jsonc` currently sets `DB.remote: true`, so
`vp dev` uses the remote database despite the local migration step. For isolated
write tests, build and run `vp exec wrangler dev --config dist/server/wrangler.json --local`
instead; this forces local bindings. Never run test mutations against real family data.

## Vite+

Everyday commands go through `vp` (the Vite+ CLI):

```sh
vp install        # install dependencies (delegates to pnpm)
vp dev            # dev server
vp check          # format, type-aware lint, and type checks
vp check --fix    # auto-fix formatting and lint issues
vp build          # production build
vp test           # focused Effect, lifecycle, domain and auth regression tests
vp run <script>   # run a script from package.json
```

Lint and formatting are configured in `vite.config.ts` (oxlint + oxfmt).
Tests use `vitest.config.ts` with fake worker bindings, not Cloudflare or D1.

## Deploy to Cloudflare

1. Create the database once:

   ```sh
   vp exec wrangler d1 create mampf-db
   ```

2. Put the returned `database_id` into `wrangler.jsonc` (replace the
   placeholder UUID).

3. Set the shared family PIN and an independent session signing secret:

   ```sh
   vp exec wrangler secret put PIN
   openssl rand -hex 32 | vp exec wrangler secret put SESSION_SECRET
   ```

   `SESSION_SECRET` must be 64 hexadecimal characters (32 random bytes). Use a
   different secret from development. No production secret belongs in git.
   The `LOGIN_RATE_LIMITER` binding is deployed from `wrangler.jsonc`; its
   namespace ID must not be reused by an unrelated limiter in your account.

4. Deploy:

   ```sh
   vp run db:migrate:remote  # apply migrations to the real database
   vp run deploy             # build + wrangler deploy
   ```

## Access protection

The app is protected by a single shared PIN that you both use:

- Sessions have a random nonce and signed expiry, authenticated with
  HMAC-SHA256 using `SESSION_SECRET`. The PIN is bound into the signature but
  never stored in the cookie. Knowing or guessing the PIN cannot forge a token
  without going through the throttled login endpoint.
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` on HTTPS. The server checks
  expiry independently of the browser's one-year cookie lifetime.
- Every protected RPC verifies the session; the SSR auth gate does not initialize D1.
- All sign-in attempts share a five-attempt/60-second limit for this family,
  per Cloudflare location, including attempts carrying the correct PIN. This
  avoids bypasses using rotating IPs or per-RPC headers. Cloudflare's limiter
  is approximate and not a strict global lockout; an attacker can temporarily
  block new sign-ins, but existing signed-in devices continue to work. Use a
  strong PIN, not the development default, for production.
- Missing secrets/limiter configuration fail closed. Limiter outages cannot
  silently disable throttling.
- "Sign out" clears this browser's cookie. Sessions are stateless, so a copied
  cookie remains valid until expiry or rotation of `PIN`/`SESSION_SECRET`.
- Upgrading from the old PIN-hash cookies signs everyone out once. Rotating
  either secret also invalidates all existing sessions.

## Structure

```
src/
├── routes/index.tsx      # Feeding/pumping forms and per-day history
├── routes/pin.tsx        # PIN gate
├── routes/__root.tsx     # HTML shell
├── router.tsx           # Per-request Atom registry and stream-aware SSR cleanup
├── client/              # Atom RPC client and temporary loader subscriptions
├── shared/              # Shared schemas, branded IDs, RPCs and typed errors
├── server/api.ts         # Database-independent auth server function
├── server/auth.server.ts # Login throttling and cookie handling
├── server/session.ts     # Session signing and verification
├── server/rpc.ts         # Effect RPC HTTP boundary
├── server/feedings.ts    # Effect domain: Feeding model + Feedings service
├── server/pumpings.ts    # Pumping model + Pumpings service
├── server/storage.ts     # Typed SQL failures; sanitized schema defects/logging
├── server/runtime.ts     # Request-scoped service layers + D1 binding wiring
└── styles.css
migrations/
```

Notes:

- Feedings are stored in UTC; the UI groups them by the browser's local day,
  so both parents see "today" correctly on their own phones.
- All server input is validated with Effect `Schema` (amount 1–1000 ml,
  pumping duration 1–60 minutes, ISO timestamp, UUID IDs) before it reaches the service layer.
- Loader prefetch subscriptions are released on completion/interruption; the
  SSR registry is disposed on stream completion/cancellation or early failure.
  Atom's 30-second TTL is idle eviction, not a polling interval.
- SQL failures become a safe `OperationUnavailable` response. Schema failures
  stay defects. Logs include operation/reason metadata, never raw queries or
  rows. Writes are not automatically retried because a lost response can leave
  the commit outcome ambiguous.
