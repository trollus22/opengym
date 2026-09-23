// Backend helpers. Sign-in is a username and a password — the WebAuthn (passkey) flow this file
// used to carry was replaced in this fork, see docs/AUTH.md. The server answers with an HttpOnly
// session cookie, so no token ever passes through here, and the only thing kept in localStorage
// is the profile's own display fields.
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)

export async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
  return data
}

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })

/** Sign in and return the profile. Throws with the server's message on a wrong username or password. */
export const signIn = async (username, password) => (await post('/api/login', { username, password })).user

/** Create a profile. `code` is the invite code when the instance is invite-only. */
export const signUp = async (username, password, code) =>
  (await post('/api/register', { username, password, code: code || '' })).user

/** Change the signed-in profile's password. Signs every other device out; this one stays in. */
export const changePassword = (current, next) => post('/api/account/password', { current, next })
