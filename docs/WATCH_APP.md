# Watch app (Amazfit Active 3 Premium / Zepp OS)

A Zepp OS mini-program that shows today's plan — already resolved to concrete weights and reps
by the same progression engine the web app uses — and lets you log the whole session from your
wrist, syncing back to your instance when you finish.

It's a separate project from `frontend/` and `api/`: Zepp OS runs its own JS engine on the watch
(no browser, no React), so this can't reuse the web app's UI the way the Capacitor mobile shell
does (`docs/MOBILE.md`). What it *does* reuse is the training logic — see "How it stays correct"
below.

Built and tested against the **Amazfit Active 3 Premium** (Zepp OS 5.0, API level 4.3, round
466×466 display). The build targets that shape and resolution generically (`st: "r", dw: 466`),
so it will likely also install on other same-shape 466px Zepp OS watches (e.g. the Amazfit GTR 4
family) — untested, but nothing here is Active-3-specific beyond the device list in `app.json`.

## Architecture

Zepp OS splits a mini-program into three pieces that can't talk to each other directly:

| | Runs where | Does what here |
|---|---|---|
| **Device app** (`page/`) | on the watch | today's plan, the guided session, the finish summary |
| **Side Service** (`app-side/`) | in the Zepp app, on your phone | the *only* piece that touches the network — signs in, calls `api/watch/*`, relays results back to the watch over BLE |
| **Settings app** (`setting/`) | in the Zepp app, on your phone | where you type your server URL, username and password — a phone keyboard beats the watch's touchscreen for that |

The watch has no direct internet access of its own in this architecture; it always goes through
your phone's connection via the Side Service. See
[Zepp OS's own architecture guide](https://docs.zepp.com/docs/guides/architecture/arc/) for more.

## How it stays correct

The watch never re-implements progression math or carries the 1,300+ exercise library. Instead,
`api/watch/plan.js` and `api/watch/finish.js` on the server **import** the same pure functions
the web app is tested against — `frontend/src/lib/progression.js`, `history.js`, `onerm.js` —
rather than a second copy of them. A resolved "today" and a finished workout are therefore
computed by exactly the code `frontend/src/lib/*.test.js` already pins down; the watch only
displays numbers and collects taps. Two small guards were added to
`frontend/src/lib/{i18n.js,exercises.js}` so those files load under plain Node (they use Vite's
`import.meta.glob`/`import.meta.env`, which don't exist outside a Vite bundle) — no behavior
change in the browser, verified with `frontend && npm test && npm run build`.

New server endpoints (session-cookie auth, same as every other `/api/*` route):

- `POST /api/watch/login` — same check as `POST /api/login`, but returns the session token in
  the response body instead of only as a cookie. Zepp OS's Side Service `fetch()` supports only
  `url`/`method`/`headers`/`body` — no cookie jar — so the watch has to read the token itself and
  send it back as `Cookie: gymsid=...` on every later request.
- `GET /api/watch/today?date=YYYY-MM-DD` — today's routine (or `{ rest: true }`), each exercise
  already carrying its live-computed target.
- `POST /api/watch/log` — `{ active }`, the finished session; returns the saved workout, PRs and
  1RM PRs, same shape `doFinishWorkout` builds in the web app.

## Setup

Prerequisites: Node 20+, a Zepp account with **Developer Mode** turned on in the Zepp app
(Profile → Settings → About → tap the version number, or search "developer mode" in the Zepp
app's help), and the Active 3 Premium paired to that phone.

```sh
npm install -g @zeppos/zeus-cli   # the official Zepp OS build tool
cd watch
npm install
zeus login                         # opens a browser to sign into your Zepp developer account
zeus dev                           # starts a dev server and prints a QR code
```

Scan the QR code from the Zepp app's Developer Mode screen to sideload the mini-program onto
your watch — no store listing or review needed for this. `app.json` ships with a placeholder
`app.appId`; if `zeus` complains about it, run `zeus create` in a scratch folder to get a real
one issued and copy it into this `app.json` (`zeus dev` may also patch it in for you on first
run — that part depends on your CLI version).

The icon at `assets/active3.r/icon.png` is a flat placeholder in openGym's accent color — swap
it for something better whenever you like, it has no effect on functionality.

### Signing in

Open the Zepp app → your watch → **openGym** in the app list → **Settings**, enter your
instance's URL, your username and password, and tap **Connect**. The status line updates once
the Side Service confirms sign-in. The password is only held long enough to complete that one
request (see `app-side/index.js`); the watch keeps the session token afterwards, the same way
your browser keeps a cookie.

## Known limitations (MVP)

- **No superset alternation.** Exercises run in the order `today` returns them; the phone app's
  A/B alternation between paired sets isn't replicated on the watch.
- **Fixed rest timer** (90s between sets, 120s between exercises) rather than your profile's own
  rest-timer setting — a device-side UI choice only, doesn't affect scoring or progression.
- **No password masking** in the phone's settings page — a limitation of the `TextInput`
  component Zepp OS's settings framework provides, not something this app can override.
- **No offline queue.** A failed sync can be retried once from the finish screen (the workout
  stays in memory until you leave that screen), but there's no background retry — losing
  connectivity and closing the app loses that session's log, same as closing a browser tab
  mid-sync would.

## Verifying a change

```sh
cd api && npm test        # api/test/watch.test.js — resolveToday / finalizeWorkout, no device needed
cd frontend && npm test   # confirms the i18n.js/exercises.js guards didn't change browser behavior
cd watch && zeus build    # compiles app.json + every page/app-side/setting file for real
```

`zeus build` doesn't need a login — it runs the same Rollup → PNG2TGA → QJSC pipeline the real
installer uses, and fails loudly on a bad `app.json`, a broken import, or a syntax error. It's
what actually caught the asset-folder naming (`assets/<target>.<shape>/icon.png`, not just
`assets/<target>/`) and the icon's minimum size while this was built. **On an ARM64 dev
machine**, the bundled `qjsc` bytecode compiler needs GLIBC ≥ 2.34; if your host is older (`ldd
--version`), run the build in a `node:22-bookworm` container instead — `zeus build` itself needs
no device or account, only network access to resolve device metadata.

What `zeus build` **can't** catch: whether a widget actually renders where you expect, whether a
`this.request`/`onRequest` round-trip actually completes over BLE, or whether the settings page
looks right in the real Zepp app. Those only get a real answer on the watch — sign in, confirm
today's plan matches what the web app shows for the same day, log a full session (adjust a
weight, let a rest timer run out at least once), and confirm the workout shows up in the web
app's history with the right volume, duration and any PRs.
