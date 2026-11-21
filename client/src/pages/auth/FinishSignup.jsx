import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api.js'
import { useAuth } from '../../auth/useAuth.js'
import { Notice } from '../../components/ui.jsx'
import { AuthShell } from './AuthShell.jsx'

const LABEL = { instagram: 'Instagram', facebook: 'Facebook' }

/** Instagram does not share an email address, so new users type one here. */
export default function FinishSignup() {
  const [q] = useSearchParams()
  const sel = q.get('sel') || ''
  const provider = LABEL[q.get('provider')] || 'your account'
  const { setUser } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try { const d = await api.post('/api/auth/finish', { sel, email }); setUser(d.user); nav('/compose', { replace: true }) } catch (err) { setError(err.message); setBusy(false) }
  }
  return (
    <AuthShell title="Finish sign-up" subtitle={`${provider} did not share an email address. Enter the one you want to use for this account.`} footer={<Link className="font-semibold text-brand" to="/login">Back to sign in</Link>}>
      {!sel ? <Notice>This link is missing its details. Start again from the sign-in page.</Notice> : (
        <form onSubmit={submit} className="space-y-3">
          {error && <Notice>{error}</Notice>}
          <label className="block text-sm font-semibold text-ink">Email
            <input className="field mt-1" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <p className="text-xs text-muted">We will send a verification link to this address.</p>
          <button className="btn btn-primary w-full justify-center" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </form>
      )}
    </AuthShell>
  )
}
