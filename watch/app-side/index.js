/* Side Service — the only piece of this app that talks to the network (see docs/WATCH_APP.md
 * for why: Zepp OS's device-side page has no direct internet access, only BLE to the phone).
 *
 * Owns three things in settingsStorage, set from the phone-side settings page:
 *   server   — the openGym instance's base URL, e.g. https://gym.example.com
 *   username — plain text, shown back in the settings UI
 *   password — write-only: consumed by attemptLogin() below and cleared immediately after,
 *              never left sitting in storage
 * and one it manages itself:
 *   cookie   — the session token from POST /api/watch/login, sent as the Cookie header on
 *              every /api/watch/* request. Zepp OS's Side Service fetch has no cookie jar (see
 *              docs/reference/side-service-api/fetch — only url/method/headers/body are
 *              supported), so this app does by hand what a browser does automatically.
 *   status   — 'connected' | 'error:<message>' | '' — read back by the settings page, which
 *              re-renders whenever settingsStorage changes (Zepp OS's own contract for it).
 */
import { BaseSideService, settingsLib } from '@zeppos/zml/base-side'

function baseUrl() {
  return String(settingsLib.getItem('server') || '').replace(/\/+$/, '')
}

async function apiFetch(path, { method = 'GET', body } = {}) {
  const base = baseUrl()
  if (!base) return { error: 'not configured — set the server URL in the openGym settings' }
  const cookie = settingsLib.getItem('cookie')
  const headers = { 'Content-Type': 'application/json' }
  if (cookie) headers.Cookie = 'gymsid=' + cookie
  try {
    const res = await fetch({ url: base + path, method, headers, body: body ? JSON.stringify(body) : undefined })
    const data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body
    if (data && data.error) return { error: data.error }
    return { data }
  } catch (e) {
    return { error: 'could not reach the server — ' + (e && e.message ? e.message : 'network error') }
  }
}

async function attemptLogin() {
  const base = baseUrl()
  const username = settingsLib.getItem('username')
  const password = settingsLib.getItem('password')
  // Consumed once, right away — a failed attempt (wrong password, unreachable server) must not
  // leave the password sitting in storage for the next unrelated settings change to retry.
  settingsLib.setItem('password', '')
  if (!base || !username || !password) {
    settingsLib.setItem('status', 'error:server, username and password are all required')
    return
  }
  const r = await apiFetch('/api/watch/login', { method: 'POST', body: { username, password } })
  if (r.error) { settingsLib.setItem('status', 'error:' + r.error); return }
  settingsLib.setItem('cookie', r.data.token)
  settingsLib.setItem('status', 'connected')
}

AppSideService(
  BaseSideService({
    onInit() {},
    onRun() {},
    onDestroy() {},

    // Fires whenever the Settings App changes a key — see the module doc above.
    onSettingsChange({ key, newValue }) {
      if (key === 'password' && newValue) attemptLogin()
    },

    onRequest(req, res) {
      if (req.method === 'GET_TODAY') {
        apiFetch('/api/watch/today?date=' + encodeURIComponent(req.params.date)).then(r => res(null, r))
      } else if (req.method === 'LOG_WORKOUT') {
        apiFetch('/api/watch/log', { method: 'POST', body: { active: req.params.active } }).then(r => res(null, r))
      } else if (req.method === 'STATUS') {
        res(null, { connected: !!settingsLib.getItem('cookie'), status: settingsLib.getItem('status') || '' })
      }
    }
  })
)
