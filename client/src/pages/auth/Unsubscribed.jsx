import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../api.js'
import { Notice } from '../../components/ui.jsx'
import { AuthShell } from './AuthShell.jsx'

/** Landing page after an unsubscribe link in an email. The server already applied it; Undo reverses it. */
export default function Unsubscribed() {
  const [q] = useSearchParams()
  const t = q.get('t') || ''
  const category = q.get('c') || 'optional'
  const error = q.get('error')
  const [undone, setUndone] = useState(false)
  const [err, setErr] = useState('')
  const undo = () => api.post('/api/email/resubscribe', { t }).then(() => setUndone(true)).catch((e) => setErr(e.message))
  return (
    <AuthShell title={error ? 'Link not valid' : undone ? 'Subscribed again' : 'Unsubscribed'} footer={<Link className="font-semibold text-brand" to="/settings#notifications">Email settings</Link>}>
      {error ? <Notice>{error}</Notice> : undone
        ? <Notice tone="good">You will get {category} emails again.</Notice>
        : (
          <div className="space-y-3">
            <p className="text-sm text-ink">You won&apos;t get {category} emails anymore. Account and security emails (like password resets) still arrive.</p>
            {err && <Notice>{err}</Notice>}
            <button className="btn btn-ghost" onClick={undo}>Undo</button>
          </div>
        )}
    </AuthShell>
  )
}
