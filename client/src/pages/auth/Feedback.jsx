import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../api.js'
import { Notice } from '../../components/ui.jsx'
import { AuthShell } from './AuthShell.jsx'

/** Public page behind the rating links in the "How was your experience?" email. The signed token is the credential. */
export default function Feedback() {
  const [q] = useSearchParams()
  const t = q.get('t') || ''
  const rating = Number(q.get('r')) || 0
  const [state, setState] = useState('saving') // saving | saved | bad
  const [error, setError] = useState('')
  const [comment, setComment] = useState('')
  const [commentState, setCommentState] = useState('') // '' | saving | done
  const ran = useRef(false) // StrictMode runs effects twice
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    if (!t || rating < 1 || rating > 5) { setState('bad'); setError('This link is not valid.'); return }
    api.post('/api/email/feedback', { t, rating }).then(() => setState('saved')).catch((e) => { setState('bad'); setError(e.message) })
  }, [t, rating])

  async function sendComment(e) {
    e.preventDefault()
    setCommentState('saving')
    try { await api.post('/api/email/feedback', { t, comment }); setCommentState('done') } catch (err) { setError(err.message); setCommentState('') }
  }
  return (
    <AuthShell title="Thanks for your feedback" footer={<Link className="font-semibold text-brand" to="/">Continue to the app</Link>}>
      {state === 'saving' && <div className="skeleton h-10" aria-label="Saving" />}
      {state === 'bad' && <Notice>{error}</Notice>}
      {state === 'saved' && (
        <div className="space-y-3">
          <Notice tone="good">You rated us {rating} out of 5. Thanks!</Notice>
          {commentState === 'done' ? <p className="text-sm text-muted">Your comment was saved.</p> : (
            <form onSubmit={sendComment} className="space-y-3">
              {error && <Notice>{error}</Notice>}
              <label className="block text-sm font-semibold text-ink">Anything you would like to add? (optional)
                <textarea className="field mt-1 min-h-24" value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} />
              </label>
              <button className="btn btn-primary" disabled={commentState === 'saving' || !comment.trim()}>{commentState === 'saving' ? 'Sending…' : 'Send comment'}</button>
            </form>
          )}
        </div>
      )}
    </AuthShell>
  )
}
