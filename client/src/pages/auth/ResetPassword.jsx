import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api.js'
import { useAuth } from '../../auth/useAuth.js'
import { Notice } from '../../components/ui.jsx'
import { AuthShell } from './AuthShell.jsx'

export default function ResetPassword() {
  const [q] = useSearchParams()
  const token = q.get('token') || ''
  const { setUser } = useAuth()
  const nav = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e) {
    e.preventDefault()
    if (password !== confirm) return setError('Passwords do not match')
    setBusy(true); setError('')
    try { const d = await api.post('/api/auth/reset-password', { token, password }); setUser(d.user); nav('/compose', { replace: true }) } catch (err) { setError(err.message); setBusy(false) }
  }
  return (
    <AuthShell title="Choose a new password" footer={<Link className="font-semibold text-brand" to="/login">Back to sign in</Link>}>
      {!token ? <Notice>This link is missing its token. Request a new one.</Notice> : (
        <form onSubmit={submit} className="space-y-3">
          {error && <Notice>{error}</Notice>}
          <label className="block text-sm font-semibold text-ink">New password
            <input className="field mt-1" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={128} required autoFocus />
            <span className="mt-1 block text-xs font-normal text-muted">At least 8 characters, with a letter and a digit.</span>
          </label>
          <label className="block text-sm font-semibold text-ink">Confirm password
            <input className="field mt-1" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
          <button className="btn btn-primary w-full justify-center" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
        </form>
      )}
    </AuthShell>
  )
}
