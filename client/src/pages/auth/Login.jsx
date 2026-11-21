import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth, safeNext } from '../../auth/useAuth.js'
import { Notice } from '../../components/ui.jsx'
import { AuthShell, SocialButtons, Divider } from './AuthShell.jsx'

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [q] = useSearchParams()
  const next = q.get('next')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(q.get('error') || '')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try { await login(email, password); nav(safeNext(next), { replace: true }) } catch (err) { setError(err.message); setBusy(false) }
  }
  const suffix = next ? `?next=${encodeURIComponent(next)}` : ''
  return (
    <AuthShell title="Sign in" subtitle="Welcome back." footer={<>New here? <Link className="font-semibold text-brand" to={`/signup${suffix}`}>Create an account</Link></>}>
      {error && <div className="mb-3"><Notice>{error}</Notice></div>}
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm font-semibold text-ink">Email
          <input className="field mt-1" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="block text-sm font-semibold text-ink">Password
          <input className="field mt-1" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <div className="text-right text-sm"><Link className="text-brand" to="/forgot-password">Forgot password?</Link></div>
        <button className="btn btn-primary w-full justify-center" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <Divider />
      <SocialButtons next={next} />
    </AuthShell>
  )
}
