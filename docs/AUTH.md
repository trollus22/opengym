# Accounts: usernames and passwords

This fork signs people in with a **username and a password**. Upstream openGym used WebAuthn
passkeys, which is a better factor in the abstract and a worse one on a box you reach through a
tunnel — a passkey is cryptographically bound to the hostname it was created for, so every time
the app moved to a new URL, every existing passkey stopped working and the account could not be
reached at all. A username and a password survive any address change.

## What replaced what

| | Before | Now |
| --- | --- | --- |
| Sign-in | WebAuthn passkey, `@simplewebauthn/server` | Username + password, `scrypt` from `node:crypto` |
| Session | HMAC-signed `gymsid` cookie | **unchanged** — same cookie, same `sv` counter |
| Users, invites, push subscriptions | `data/db.json` | `users`, `invites`, `push_subs` tables |
| Per-profile state | `data/state-<uid>.json` | `states` table (one `jsonb` row per profile) |
| Storage | JSON files on the volume | Postgres (the self-hosted Supabase on this box) |
| Endpoints | `/api/register/options`, `/api/register/verify`, `/api/login/options`, `/api/login/verify` | `/api/register`, `/api/login`, `/api/account/password` |

Everything else — the plan, workouts, body weight, stats, the admin dashboard, invites, push,
the AI Coach — behaves exactly as it did. The Coach still reads each profile's state through the
same synchronous helper it always used; the helper now reads the in-memory mirror of the table
instead of a file.

## Where the data actually is

The API container joins the `supabase_default` docker network and connects to `supabase-db` by
service name. Nothing new is published on a port, and there is no Supabase API key anywhere in
the stack — the API is a direct Postgres client with a role that can only touch its own database.

```
DATABASE_URL=postgres://opengym:***@supabase-db:5432/opengym
```

Tables (created automatically on boot, `CREATE TABLE IF NOT EXISTS`):

- `users` — `id`, `username` (unique, case-insensitive via `username_lc`), `password_hash`,
  `name`, `admin`, `disabled`, `sv` (session version), `invited_by`, `last_reminder`, `created`
- `states` — `user_id`, `state` (`jsonb`), `updated_at`
- `push_subs` — `endpoint` (primary key), `user_id`, `keys` (`jsonb`)
- `invites` — `code`, `note`, `created_by`, `used_by`, `used_at`, `revoked`

### Passwords

`scrypt` with N=16384, r=8, p=1, a 16-byte random salt and a 64-byte key, stored as
`scrypt$N$r$p$salt$key` — the parameters travel with the hash, so the cost can be raised later
without a migration. Minimum length is 8 (published to the client as `password_min` so the form
enforces the same rule the server does). Roughly 40ms per attempt on this box, which is the
point: a self-hosted instance has no rate limiter in front of it. On top of that, `/api/login`
counts failures per username-and-client and per client, and answers an unknown username with the
same status, the same body and the same timing as a wrong password — the endpoint cannot be used
to find out who has an account here.

Passwords are never written to a log, never returned by any endpoint, and there is no
"recover" link: **there is no e-mail on this instance.** If one is lost, an admin sets a new one
from the admin dashboard (Admin → user → Reset password), which also signs that profile out
everywhere.

## Common jobs

**Make someone an admin** — flag it on the account, then the admin dashboard is where it is
handed out from then on. `psql -U postgres` works inside the container without a password
because that role is a member of the `opengym` role; TCP connections as `opengym` need its
password instead (`-h 127.0.0.1` plus `PGPASSWORD` from `DATABASE_URL`).

```bash
sudo docker exec supabase-db psql -U postgres -d opengym \
  -c "UPDATE users SET admin = true WHERE username_lc = 'someone';"
# then restart the api so the in-memory mirror reloads
sudo docker compose restart api
```

**Reset a password from the shell** (when nobody can sign in at all):

```bash
sudo docker exec opengym-api-1 node --input-type=module -e "
  import('./password.js').then(m => console.log(m.hashPassword(process.argv[1])))
" 'the-new-password'
# ^ paste the result into:
#   UPDATE users SET password_hash = '...' , sv = sv + 1 WHERE username_lc = 'someone';
```

**Require an invite code for new profiles** — `INVITE_ONLY=1` in `.env`, restart, then generate
codes from the admin dashboard.

**Back up** — the database, and the remaining files in `data/` (the session secret, VAPID keys,
the encrypted Coach credential, and the old JSON files kept as a record):

```bash
sudo docker exec supabase-db pg_dump -U opengym -d opengym > opengym-$(date +%F).sql
sudo tar czf opengym-data-$(date +%F).tar.gz -C /home/ubuntu/opengym data
```

Restoring is `psql -U opengym -d opengym < opengym-YYYY-MM-DD.sql`. The `data/` tarball matters
even though the app no longer reads its JSON: `secret` signs the session cookies, so losing it
signs everybody out, and `vapid.json` is what keeps push subscriptions valid.

**One-time import.** On the first boot against an empty `states` table, any `data/state-*.json`
files are imported and left in place. The old `data/db.json` is *not* imported — those profiles
had no password and could never have signed in — so if you are coming from a passkey instance,
create the account you want and point it at the state you had, keyed by its user id:

```bash
sudo docker exec supabase-db psql -U opengym -d opengym -c "
  INSERT INTO states (user_id, state)
  SELECT 'new-user-id', state FROM states WHERE user_id = 'old-user-id'
  ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state;"
```

## Security notes

- The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` whenever `ORIGIN` is `https://`.
  It carries an expiry and the account's session-version counter, and the version is what makes
  "Sign out everywhere" and a password change cut every other device off at once.
- Passwords stop being guessable, so the thing worth protecting is the cookie and the tunnel.
  This instance terminates TLS at Cloudflare: put a real rate limit or a Cloudflare Access rule
  in front of it if it is ever exposed to more than yourself.
- `data/` is `chmod 0700` and the Coach's agent runtime runs as an unprivileged user that cannot
  read the session secret or the app's data.
