/* HTTP surface for the Zepp OS watch app. Same session cookie as every other route (readSession)
 * — the watch's app-side signs in through the existing POST /api/login and just keeps the
 * cookie, no separate auth. See docs/WATCH_APP.md.
 */
import * as store from '../store.js';
import { resolveToday } from './plan.js';
import { finalizeWorkout } from './finish.js';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
// Server's own date as a fallback only (curl/testing without a `date` param) — the watch always
// sends its own local date, same convention frontend's todayISO() follows on every other client.
function serverToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function watchRoutes({ json, readBody, readSession, attemptLogin, makeSession, publicUser }) {
  return {
    // Same credential check as POST /api/login, but the session token comes back in the body:
    // app-side stores it and sets it as the Cookie header on every /api/watch/* request itself
    // (the Side Service fetch API doesn't give it a cookie jar the way a browser has one).
    'POST /api/watch/login': async (req, res) => {
      const body = await readBody(req);
      const r = await attemptLogin(body, req);
      if (r.error) return json(res, r.status, { error: r.error });
      json(res, 200, { user: publicUser(r.user), token: makeSession(r.user) });
    },

    'GET /api/watch/today': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const q = new URL(req.url, 'http://x').searchParams.get('date');
      const iso = q && ISO_RE.test(q) ? q : serverToday();
      const state = store.getState(user.id) || {};
      json(res, 200, resolveToday(state, iso));
    },

    'POST /api/watch/log': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const body = await readBody(req);
      const active = body.active;
      if (!active || typeof active !== 'object' || !Array.isArray(active.entries))
        return json(res, 400, { error: 'active workout required' });
      if (!active.entries.some(e => (e.sets || []).some(s => s && s.done)))
        return json(res, 400, { error: 'nothing logged' });

      const state = store.getState(user.id) || {};
      const { workout, prs, e1prs } = finalizeWorkout(state, active);
      await store.putState(user.id, state);
      json(res, 200, { workout, prs, e1prs });
    }
  };
}
