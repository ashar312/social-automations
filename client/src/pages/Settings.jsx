import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FaFacebook, FaInstagram, FaLinkedin } from 'react-icons/fa6'
import { api } from '../api.js'
import { useAuth } from '../auth/useAuth.js'
import { Notice, PageTitle } from '../components/ui.jsx'
import { useConfirm } from '../components/useConfirm.js'

function useSave() {
  const [state, setState] = useState({ busy: false, error: '', ok: '' })
  const run = async (fn, okMsg) => {
    setState({ busy: true, error: '', ok: '' })
    try { await fn(); setState({ busy: false, error: '', ok: okMsg }) } catch (e) { setState({ busy: false, error: e.message, ok: '' }) }
  }
  return [state, run]
}
const Msg = ({ s }) => (s.error ? <Notice>{s.error}</Notice> : s.ok ? <Notice tone="good">{s.ok}</Notice> : null)

function Profile() {
  const { user, setUser, refresh } = useAuth()
  const [name, setName] = useState(user.name)
  const [phone, setPhone] = useState(user.phone || '')
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || '')
  const [s, run] = useSave()
  const [resent, setResent] = useState('')
  const submit = (e) => {
    e.preventDefault()
    run(async () => { const d = await api.patch('/api/account/profile', { name, phone: phone || null, avatarUrl }); setUser(d.user) }, 'Profile saved')
  }
  const resend = () => api.post('/api/auth/resend-verification').then((d) => { setResent(d.sent ? 'Verification email sent' : 'Could not send email'); refresh() }).catch((e) => setResent(e.message))
  return (
    <form onSubmit={submit} className="card space-y-3 p-5">
      <h2 className="card-title">Profile</h2>
      <Msg s={s} />
      <label className="block text-sm font-semibold text-ink">Name
        <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
      </label>
      <div className="text-sm">
        <span className="font-semibold text-ink">Email</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span>{user.email}</span>
          <span className={`pill ${user.emailVerified ? 'pill-good' : 'pill-warn'}`}>{user.emailVerified ? 'Verified' : 'Not verified'}</span>
          {!user.emailVerified && <button type="button" className="font-semibold text-brand" onClick={resend}>Resend link</button>}
          {resent && <span className="text-muted">{resent}</span>}
        </div>
      </div>
      <label className="block text-sm font-semibold text-ink">Phone number
        <input className="field mt-1" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+92 300 1234567" />
      </label>
      <label className="block text-sm font-semibold text-ink">Avatar URL
        <input className="field mt-1" type="url" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
      </label>
      <button className="btn btn-primary" disabled={s.busy}>{s.busy ? 'Saving…' : 'Save profile'}</button>
    </form>
  )
}

function Password() {
  const { user, setUser } = useAuth()
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [s, run] = useSave()
  const submit = (e) => {
    e.preventDefault()
    if (pw !== confirm) return run(async () => { throw new Error('Passwords do not match') })
    run(async () => {
      const d = await api.post('/api/account/password', { currentPassword: user.hasPassword ? cur : undefined, newPassword: pw })
      setUser(d.user); setCur(''); setPw(''); setConfirm('')
    }, user.hasPassword ? 'Password changed. Other devices were signed out.' : 'Password set')
  }
  return (
    <form onSubmit={submit} className="card space-y-3 p-5">
      <h2 className="card-title">{user.hasPassword ? 'Change password' : 'Set password'}</h2>
      {!user.hasPassword && <p className="text-sm text-muted">You signed up with a social account. Set a password to also sign in with your email.</p>}
      <Msg s={s} />
      {user.hasPassword && (
        <label className="block text-sm font-semibold text-ink">Current password
          <input className="field mt-1" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        </label>
      )}
      <label className="block text-sm font-semibold text-ink">New password
        <input className="field mt-1" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} maxLength={128} required />
      </label>
      <label className="block text-sm font-semibold text-ink">Confirm new password
        <input className="field mt-1" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      <button className="btn btn-primary" disabled={s.busy}>{s.busy ? 'Saving…' : user.hasPassword ? 'Change password' : 'Set password'}</button>
    </form>
  )
}

const METHODS = [['linkedin', 'LinkedIn', FaLinkedin], ['facebook', 'Facebook', FaFacebook], ['instagram', 'Instagram', FaInstagram]]

function SignInMethods() {
  const { user, setUser } = useAuth()
  const confirm = useConfirm()
  const [q] = useSearchParams()
  const [s, run] = useSave()
  const [enabled, setEnabled] = useState({})
  useEffect(() => { api.get('/api/auth/providers').then(setEnabled).catch(() => {}) }, [])
  const unlink = async (key, label) => {
    if (!(await confirm({ title: `Unlink ${label} sign-in?`, body: `You will no longer be able to sign in with ${label}. Your project connections are not affected.`, confirmLabel: 'Unlink' }))) return
    run(async () => { const d = await api.del(`/api/account/identities/${key}`); setUser(d.user) }, `${label} unlinked`)
  }
  return (
    <div className="card space-y-3 p-5">
      <h2 className="card-title">Sign-in methods</h2>
      {q.get('linked') && <Notice tone="good">Account linked.</Notice>}
      {q.get('error') && <Notice>{q.get('error')}</Notice>}
      <Msg s={s} />
      {METHODS.map(([key, label, Icon]) => {
        const linked = user.identities.includes(key)
        return (
          <div key={key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 font-semibold text-ink"><Icon aria-hidden="true" />{label} {linked && <span className="pill pill-good">Linked</span>}</span>
            {linked
              ? <button className="btn btn-ghost btn-sm" onClick={() => unlink(key, label)}>Unlink</button>
              : enabled[key]
                ? <a className="btn btn-ghost btn-sm" href={`/api/auth/${key}/start?mode=link`}>Link {label}</a>
                : <span className="text-xs text-muted">Coming soon</span>}
          </div>
        )
      })}
      <p className="text-xs text-muted">Signing in with a social account is separate from connecting it to a project to post.</p>
    </div>
  )
}

function Sessions() {
  const [list, setList] = useState(null)
  const [s, run] = useSave()
  const load = useCallback(() => api.get('/api/account/sessions').then((d) => setList(d.sessions)).catch(() => setList([])), [])
  useEffect(() => { load() }, [load])
  const out = (id) => run(async () => { await api.del(`/api/account/sessions/${id}`); await load() }, 'Signed out')
  const others = () => run(async () => { await api.del('/api/account/sessions'); await load() }, 'Other devices signed out')
  return (
    <div className="card space-y-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="card-title">Active sessions</h2>
        {list && list.length > 1 && <button className="btn btn-ghost btn-sm" onClick={others}>Sign out all others</button>}
      </div>
      <Msg s={s} />
      {!list ? <div className="skeleton h-16" /> : (
        <ul className="divide-y divide-line text-sm">
          {list.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{x.userAgent || 'Unknown device'} {x.current && <span className="pill pill-good ml-1">This device</span>}</span>
                <span className="text-xs text-muted">{x.ip || '—'} · last seen {new Date(x.lastSeenAt).toLocaleString()}</span>
              </span>
              {!x.current && <button className="btn btn-ghost btn-sm" onClick={() => out(x.id)}>Sign out</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const TOGGLES = [
  ['dailySummary', 'Daily summary', 'Every morning: which scheduled posts went out yesterday, and what is coming up today.'],
  ['productTips', 'Tips and reminders', 'A nudge to schedule your first post, and a note when you have been away for a few days.'],
  ['feedback', 'Feedback requests', 'One short question a few days after your first published post.'],
]
const zones = () => { try { return Intl.supportedValuesOf('timeZone') } catch { return [] } }

function Notifications() {
  const [prefs, setPrefs] = useState(null)
  const [tz, setTz] = useState('')
  const [s, run] = useSave()
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  useEffect(() => { api.get('/api/account/notifications').then((d) => { setPrefs(d.prefs); setTz(d.timezone) }).catch(() => setPrefs({})) }, [])
  const save = (patch, msg) => run(async () => { const d = await api.patch('/api/account/notifications', patch); setPrefs(d.prefs); setTz(d.timezone) }, msg)
  if (!prefs) return <div className="card p-5"><div className="skeleton h-24" aria-label="Loading" /></div>
  const list = zones()
  return (
    <div id="notifications" className="card space-y-3 p-5">
      <h2 className="card-title">Email notifications</h2>
      <Msg s={s} />
      <ul className="divide-y divide-line">
        {TOGGLES.map(([key, label, help]) => (
          <li key={key} className="flex items-start justify-between gap-4 py-3">
            <div><div className="text-sm font-semibold text-ink">{label}</div><div className="text-sm text-muted">{help}</div></div>
            <input type="checkbox" className="mt-1 h-5 w-5 accent-brand" checked={!!prefs[key]} disabled={s.busy} aria-label={label} onChange={(e) => save({ [key]: e.target.checked }, 'Saved')} />
          </li>
        ))}
        <li className="flex items-start justify-between gap-4 py-3 opacity-70">
          <div><div className="text-sm font-semibold text-ink">Account and security</div><div className="text-sm text-muted">Welcome, password reset, password changed and new connections. Always on.</div></div>
          <input type="checkbox" className="mt-1 h-5 w-5" checked disabled aria-label="Account and security emails are always on" readOnly />
        </li>
      </ul>
      <label className="block text-sm font-semibold text-ink">Time zone
        <select className="field mt-1" value={tz} disabled={s.busy} onChange={(e) => save({ timezone: e.target.value }, 'Time zone saved')}>
          {(list.includes(tz) ? list : [tz, ...list]).map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <span className="mt-1 block text-xs font-normal text-muted">The daily summary arrives around 9 AM in this time zone.</span>
      </label>
      {browserTz && browserTz !== tz && (
        <p className="text-sm text-muted">Your browser is in {browserTz}. <button type="button" className="font-semibold text-brand" onClick={() => save({ timezone: browserTz }, 'Time zone saved')}>Use it</button></p>
      )}
    </div>
  )
}

export default function Settings() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageTitle eyebrow="Account" title="Settings" />
      <Profile />
      <Password />
      <Notifications />
      <SignInMethods />
      <Sessions />
    </div>
  )
}
