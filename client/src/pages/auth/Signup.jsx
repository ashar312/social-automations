import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth, safeNext } from '../../auth/useAuth.js'
import { Notice } from '../../components/ui.jsx'
import { AuthShell, SocialButtons, Divider } from './AuthShell.jsx'

export default function Signup() {
  const { signup } = useAuth()
  const nav = useNavigate()
  const [q] = useSearchParams()
  const next = q.get('next')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try { await signup(name, email, password); nav(safeNext(next), { replace: true }) } catch (err) { setError(err.message); setBusy(false) }
  }
  return (
    <AuthShell title="Create your account" subtitle="Manage all your social channels in one place." footer={<>Already have an account? <Link className="font-semibold text-brand" to="/login">Sign in</Link></>}>
      {error && <div className="mb-3"><Notice>{error}</Notice></div>}
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm font-semibold text-ink">Name
          <input className="field mt-1" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
        </label>
        <label className="block text-sm font-semibold text-ink">Email
          <input className="field mt-1" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block text-sm font-semibold text-ink">Password
          <input className="field mt-1" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={128} required />
          <span className="mt-1 block text-xs font-normal text-muted">At least 8 characters, with a letter and a digit.</span>
        </label>
        <button className="btn btn-primary w-full justify-center" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <Divider />
      <SocialButtons next={next} />
    </AuthShell>
  )
}
