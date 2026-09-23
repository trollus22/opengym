/* Postgres storage — users, per-profile state, push subscriptions and invites.
 *
 * Where the data lives now: a Postgres database of its own ("opengym") inside the self-hosted
 * Supabase on this box, reached over the compose network by service name. Nothing is exposed
 * on a port and no Supabase API key is involved — the API container talks to Postgres directly
 * with a role that can only touch this one database. What used to be ./data/db.json and
 * ./data/state-*.json is in tables here instead.
 *
 * Why an in-memory mirror rather than async everywhere: the server's hot paths are synchronous.
 * The "workout planned today" reminder walks every profile's state on a 10-second timer, the
 * admin dashboard reads each profile's workouts, and the Coach cadence inspects state on a
 * schedule. There are a handful of profiles, so loading the tables once at boot and reading from
 * memory keeps every one of those call sites exactly as they were, while Postgres stays the
 * source of truth — kill the process and the next boot reads back what was committed.
 *
 * Writes: mutations touch the in-memory objects and call saveDb(), which mirrors the whole set
 * back in one transaction. Diffing hundreds of rows against a whole table is not work worth
 * optimising at this size, and a full mirror cannot drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DATA = process.env.DATA_DIR || '/data';
const CONNECTION = process.env.DATABASE_URL || '';

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  username      text NOT NULL,
  username_lc   text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text NOT NULL,
  admin         boolean NOT NULL DEFAULT false,
  disabled      boolean NOT NULL DEFAULT false,
  sv            integer NOT NULL DEFAULT 0,
  invited_by    text,
  last_reminder text,
  created       timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS states (
  user_id    text PRIMARY KEY,
  state      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint text PRIMARY KEY,
  user_id  text NOT NULL,
  keys     jsonb NOT NULL,
  created  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subs_user_idx ON push_subs (user_id);
CREATE TABLE IF NOT EXISTS invites (
  code       text PRIMARY KEY,
  note       text,
  created_by text,
  created    timestamptz NOT NULL DEFAULT now(),
  used_by    text,
  used_at    timestamptz,
  revoked    boolean NOT NULL DEFAULT false
);
`;

// Live view of the database. server.js reads and mutates these arrays directly — the same shape
// db.json used to have, minus the credentials that no longer exist.
export const db = { users: [], subs: [], invites: [] };
const states = new Map();          // uid -> state object (null is never stored)

let pool = null;
let writeQueue = Promise.resolve();

/* ---------- row mapping ---------- */

const iso = v => (v instanceof Date ? v.toISOString() : (v == null ? null : String(v)));

const userFromRow = r => ({
  id: r.id,
  username: r.username,
  password_hash: r.password_hash,
  name: r.name,
  admin: r.admin,
  disabled: r.disabled,
  sv: r.sv,
  ...(r.invited_by ? { invitedBy: r.invited_by } : {}),
  ...(r.last_reminder ? { lastReminder: r.last_reminder } : {}),
  created: iso(r.created)
});

const userRow = u => [
  u.id, u.username, String(u.username).toLowerCase(), u.password_hash, u.name,
  !!u.admin, !!u.disabled, u.sv || 0, u.invitedBy || null, u.lastReminder || null,
  u.created || new Date().toISOString()
];

const USER_COLUMNS = '(id, username, username_lc, password_hash, name, admin, disabled, sv, invited_by, last_reminder, created, updated_at)';

/* ---------- boot ---------- */

export async function init() {
  if (!CONNECTION) throw new Error('DATABASE_URL is not set — openGym stores users and state in Postgres now (see docs/AUTH.md)');
  pool = new pg.Pool({ connectionString: CONNECTION, max: 4, idleTimeoutMillis: 30000 });
  pool.on('error', e => console.error('store: idle client error', e.message));
  await pool.query(DDL);
  await load();
  await importLegacyStates();
  const host = (() => { try { const u = new URL(CONNECTION); return u.host + u.pathname; } catch { return 'configured database'; } })();
  console.log(`store: Postgres ready (${host}) — ${db.users.length} user(s), ${states.size} state row(s)`);
}

async function load() {
  const [users, subs, invites] = await Promise.all([
    pool.query('SELECT * FROM users ORDER BY created'),
    pool.query('SELECT endpoint, user_id, keys, created FROM push_subs'),
    pool.query('SELECT code, note, created_by, created, used_by, used_at, revoked FROM invites ORDER BY created')
  ]);
  db.users = users.rows.map(userFromRow);
  db.subs = subs.rows.map(r => ({ userId: r.user_id, endpoint: r.endpoint, keys: r.keys, created: iso(r.created) }));
  db.invites = invites.rows.map(r => ({
    code: r.code, note: r.note || '', createdBy: r.created_by,
    created: iso(r.created),
    ...(r.used_by ? { usedBy: r.used_by } : {}),
    ...(r.used_at ? { usedAt: iso(r.used_at) } : {}),
    ...(r.revoked ? { revoked: true } : {})
  }));
  states.clear();
  const rows = await pool.query('SELECT user_id, state FROM states');
  for (const r of rows.rows) states.set(r.user_id, r.state);
}

/* One-time import of the JSON files this app used to keep in ./data. Runs only when the states
   table is empty, so it can never overwrite live rows, and it leaves the files on disk — an
   import you can inspect beats a migration that deletes its own evidence. */
async function importLegacyStates() {
  if (states.size) return;
  let files = [];
  try {
    files = fs.readdirSync(DATA).filter(f => /^state-[A-Za-z0-9_-]+\.json$/.test(f));
  } catch { return; }
  let imported = 0;
  for (const f of files) {
    const uid = f.slice('state-'.length, -'.json'.length);
    try {
      await putState(uid, JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')));
      imported++;
    } catch (e) { console.error('store: could not import', f, e.message); }
  }
  if (imported) console.log(`store: imported ${imported} legacy state file(s) from ${DATA} (files left in place as a backup)`);
}

/* ---------- users ---------- */

export const findUser = id => db.users.find(u => u.id === id) || null;
export const findByUsername = username => {
  const want = String(username || '').trim().toLowerCase();
  if (!want) return null;
  return db.users.find(u => String(u.username || '').toLowerCase() === want) || null;
};

/** Insert a new profile. Returns null if the username is already taken (unique violation). */
export async function createUser(user) {
  try {
    await pool.query(
      `INSERT INTO users ${USER_COLUMNS} VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())`,
      userRow(user)
    );
  } catch (e) {
    if (e.code === '23505') return null;      // someone claimed the name first
    throw e;
  }
  db.users.push(user);
  return user;
}

/* ---------- per-profile state ---------- */

/** Synchronous read of a profile's state, or null when it has never synced. */
export const getState = uid => (states.has(uid) ? states.get(uid) : null);

/** Fill the in-memory mirror without touching Postgres — the legacy import uses it, and so do
 *  the api tests, which exercise the Coach without a database. */
export function primeState(uid, state) {
  if (state == null) states.delete(uid); else states.set(uid, state);
}

/** Write-through. The caller's request is only answered once Postgres has committed it. */
export async function putState(uid, state) {
  states.set(uid, state);
  await pool.query(
    `INSERT INTO states (user_id, state, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [uid, JSON.stringify(state)]
  );
}

export async function dropState(uid) {
  states.delete(uid);
  await pool.query('DELETE FROM states WHERE user_id = $1', [uid]);
}

export const stateCount = () => states.size;

/* ---------- write-through mirror ---------- */

/** Mirror every in-memory collection back to Postgres, serialised behind the previous write. */
export function saveDb() {
  writeQueue = writeQueue.then(persist).catch(e => console.error('store: save failed —', e.message));
  return writeQueue;
}

/** Resolves once every queued write has been applied. Used by tests and on shutdown. */
export function flush() { return writeQueue; }

async function persist() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const u of db.users) {
      await client.query(
        `INSERT INTO users ${USER_COLUMNS} VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
         ON CONFLICT (id) DO UPDATE SET
           username = EXCLUDED.username, username_lc = EXCLUDED.username_lc,
           password_hash = EXCLUDED.password_hash, name = EXCLUDED.name,
           admin = EXCLUDED.admin, disabled = EXCLUDED.disabled, sv = EXCLUDED.sv,
           invited_by = EXCLUDED.invited_by, last_reminder = EXCLUDED.last_reminder,
           updated_at = now()`,
        userRow(u)
      );
    }
    // NOT (id = ANY(...)) rather than <> ALL(...): with an empty array the latter is vacuously
    // true for every row, which would wipe the table if the in-memory list ever came up empty.
    if (db.users.length) {
      await client.query('DELETE FROM users WHERE NOT (id = ANY($1::text[]))', [db.users.map(u => u.id)]);
    }

    for (const s of db.subs) {
      await client.query(
        `INSERT INTO push_subs (endpoint, user_id, keys, created) VALUES ($1,$2,$3::jsonb,$4)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, keys = EXCLUDED.keys`,
        [s.endpoint, s.userId, JSON.stringify(s.keys || {}), s.created || new Date().toISOString()]
      );
    }
    if (db.subs.length) {
      await client.query('DELETE FROM push_subs WHERE NOT (endpoint = ANY($1::text[]))', [db.subs.map(s => s.endpoint)]);
    } else {
      await client.query('DELETE FROM push_subs');
    }

    for (const i of db.invites) {
      await client.query(
        `INSERT INTO invites (code, note, created_by, created, used_by, used_at, revoked)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (code) DO UPDATE SET note = EXCLUDED.note, used_by = EXCLUDED.used_by,
           used_at = EXCLUDED.used_at, revoked = EXCLUDED.revoked`,
        [i.code, i.note || null, i.createdBy || null, i.created || new Date().toISOString(),
          i.usedBy || null, i.usedAt || null, !!i.revoked]
      );
    }
    if (db.invites.length) {
      await client.query('DELETE FROM invites WHERE NOT (code = ANY($1::text[]))', [db.invites.map(i => i.code)]);
    } else {
      await client.query('DELETE FROM invites');
    }

    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection is already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function close() {
  await flush();
  if (pool) await pool.end();
  pool = null;
}
