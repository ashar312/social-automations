import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../api.js'
import { useAuth } from '../../auth/useAuth.js'
import { Notice } from '../../components/ui.jsx'
import { AuthShell } from './AuthShell.jsx'

export default function VerifyEmail() {
  const [q] = useSearchParams()
  const { user, refresh } = useAuth()
  const [state, setState] = useState('working') // working | ok | bad
  const [msg, setMsg] = useState('')
  const ran = useRef(false) // StrictMode runs effects twice; the token is single-use
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    api.post('/api/auth/verify-email', { token: q.get('token') || '' })
      .then(() => { setState('ok'); refresh() })
      .catch((e) => { setState('bad'); setMsg(e.message) })
  }, [q, refresh])
  const resend = () => api.post('/api/auth/resend-verification').then(() => setMsg('A new link was sent.')).catch((e) => setMsg(e.message))
  return (
    <AuthShell title="Verify email" footer={<Link className="font-semibold text-brand" to="/">Continue to the app</Link>}>
      {state === 'working' && <div className="skeleton h-10" aria-label="Verifying" />}
      {state === 'ok' && <Notice tone="good">Your email is verified.</Notice>}
      {state === 'bad' && (
        <div className="space-y-3">
          <Notice>{msg || 'This link has expired or was already used.'}</Notice>
          {user && !user.emailVerified && <button className="btn btn-primary" onClick={resend}>Send a new link</button>}
        </div>
      )}
    </AuthShell>
  )
}
