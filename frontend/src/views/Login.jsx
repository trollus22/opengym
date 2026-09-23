import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { signIn, signUp, api } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, TextField } from '../components/ui.jsx'

const MIN_FALLBACK = 8

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState } = useStore()
  const config = useStore(s => s.config)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [inviteOnly, setInviteOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  useEffect(() => { api('/api/config').then(c => setInviteOnly(!!c.invite_only)).catch(() => {}) }, [])
  const min = config?.password_min || MIN_FALLBACK

  const go = async () => {
    const name = username.trim()
    const toast = useUI.getState().toast
    if (!name) { toast(t('Enter a username')); return }
    if (password.length < min) { toast(t('Your password needs at least {0} characters.', min)); return }
    if (password !== confirm) { toast(t('The two passwords are not the same.')); return }
    if (inviteOnly && !code.trim()) { toast(t('An invite code is required')); return }
    setBusy(true)
    try {
      const u = await signUp(name, password, code.trim())
      setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); toast(t('Profile created — data from this device moved into it')) }
      else { await pullState(); toast(t('Welcome, {0}', u.name)) }
    } catch (e) { toast(e.message || t('Registration failed')) }
    finally { setBusy(false) }
  }

  return <>
    <h3>{t('Create a profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a username and a password — they sign you in on any device.')}</div>
    <TextField ref={ref} value={username} onChange={e => setUsername(e.target.value)} placeholder={t('Username')}
      maxLength={32} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
    <div style={{ height: 10 }} />
    <TextField type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={t('Password')}
      autoComplete="new-password" />
    <div style={{ height: 10 }} />
    <TextField type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={t('Confirm password')}
      autoComplete="new-password" />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <TextField value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder={t('Invite code')}
        maxLength={40} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
    </>}
    <div className="dim small" style={{ marginTop: 8 }}>{t('At least {0} characters. There is no password reset by e-mail — write it down somewhere safe.', min)}</div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go} disabled={busy}>{busy ? t('Creating…') : t('Create profile')}</Button>
  </>
}

export default function Login() {
  const { setUser, pullState, setGuest } = useStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async ev => {
    if (ev?.preventDefault) ev.preventDefault()
    if (busy) return
    const toast = useUI.getState().toast
    if (!username.trim() || !password) { toast(t('Enter your username and password')); return }
    setBusy(true)
    try {
      const u = await signIn(username.trim(), password)
      setUser(u)
      await pullState()
      toast(t('Welcome back, {0}', u.name))
    } catch (e) { toast(e.message || t('Sign-in failed')) }
    finally { setBusy(false) }
  }

  const head = <>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>openGym</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'left', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Sign-in and sync across your devices come with the openGym server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 26 }}>{t('Your workouts. Your weights. Your profile.')}</div>
      <form onSubmit={submit} style={{ textAlign: 'left' }}>
        <TextField value={username} onChange={e => setUsername(e.target.value)} placeholder={t('Username')}
          autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <div style={{ height: 10 }} />
        <TextField type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={t('Password')}
          autoComplete="current-password" />
        <div style={{ height: 14 }} />
        <Button variant="primary" type="submit" icon="person" disabled={busy} style={{ width: '100%' }}>
          {busy ? t('Signing in…') : t('Sign in')}
        </Button>
      </form>
      <div style={{ height: 10 }} />
      <Button icon="sparkles" onClick={() => useUI.getState().openSheet(close => <RegisterSheet close={close} />)}>{t('Create a profile')}</Button>
      <div style={{ height: 10 }} />
      <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('Sign in on your phone and your laptop and your data follows you.')}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
    </div>
  )
}
