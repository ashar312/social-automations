import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api.js'
import { Notice } from '../../components/ui.jsx'
import { AuthShell } from './AuthShell.jsx'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try { await api.post('/api/auth/forgot-password', { email }); setDone(true) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <AuthShell title="Forgot password" subtitle="We will email you a link to choose a new one." footer={<Link className="font-semibold text-brand" to="/login">Back to sign in</Link>}>
      {done ? <Notice tone="good">If an account exists for that email, we sent a reset link. It works for 30 minutes.</Notice> : (
        <form onSubmit={submit} className="space-y-3">
          {error && <Notice>{error}</Notice>}
          <label className="block text-sm font-semibold text-ink">Email
            <input className="field mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <button className="btn btn-primary w-full justify-center" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
    </AuthShell>
  )
}
