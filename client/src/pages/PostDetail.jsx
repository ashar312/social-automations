import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, PLATFORM_LABEL } from '../api.js'
import { ICON } from './History.jsx'

export default function PostDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const [post, setPost] = useState(null)
  const [raw, setRaw] = useState({})
  const [error, setError] = useState('')

  const load = useCallback(() => api.get(`/api/posts/${id}`).then((d) => setPost(d.post)).catch((e) => setError(e.message)), [id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!post || !['queued', 'publishing'].includes(post.status)) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [post, load])

  async function retry(platform) {
    await api.post(`/api/posts/${id}/targets/${platform}/retry`)
    load()
  }
  async function remove() {
    const remote = post.targets.some((t) => t.status === 'published') && confirm('Also delete from the platforms where the API allows it (not Instagram)?')
    if (!confirm('Delete this post from history?')) return
    await api.del(`/api/posts/${id}${remote ? '?remote=true' : ''}`)
    nav('/history')
  }

  if (error) return <p className="text-red-700">{error}</p>
  if (!post) return <p>Loading…</p>

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/history" className="text-sm text-indigo-600">← History</Link>
          <h1 className="text-xl font-semibold">Post #{post.id} <span className="text-sm font-normal text-slate-500">· {post.contentType} · {post.status}</span></h1>
        </div>
        <button onClick={remove} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">Delete</button>
      </div>

      {post.caption && <p className="whitespace-pre-wrap rounded bg-white p-3 text-sm">{post.caption}</p>}
      <div className="flex flex-wrap gap-3">
        {post.media.map((m) => <img key={m.id} src={`/api/media/${m.id}/thumb`} alt="" className="h-28 rounded" onError={(e) => { e.currentTarget.style.display = 'none' }} />)}
      </div>

      {post.targets.map((t) => {
        const logs = post.logs.filter((l) => l.targetId === t.id)
        return (
          <section key={t.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">{ICON[t.status]} {PLATFORM_LABEL[t.platform]} <span className="text-sm font-normal text-slate-500">· {t.status}{t.attempts ? ` · ${t.attempts} attempt(s)` : ''}</span></h2>
              <div className="flex gap-2 text-sm">
                {t.externalUrl && <a href={t.externalUrl} target="_blank" rel="noreferrer" className="rounded bg-indigo-600 px-3 py-1 text-white">Open post</a>}
                {['failed', 'skipped'].includes(t.status) && t.status === 'failed' && <button onClick={() => retry(t.platform)} className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50">Retry</button>}
              </div>
            </div>
            {['uploading', 'processing'].includes(t.status) && (
              <div className="mt-2 h-2 rounded bg-slate-200"><div className="h-2 rounded bg-indigo-600" style={{ width: `${t.progress}%` }} /></div>
            )}
            {t.errorMessage && <p className="mt-2 text-sm text-red-700">{t.errorMessage}</p>}
            {t.errorRaw && (
              <div className="mt-1 text-xs">
                <button onClick={() => setRaw((r) => ({ ...r, [t.id]: !r[t.id] }))} className="text-slate-500 underline">{raw[t.id] ? 'Hide' : 'Show'} raw error</button>
                {raw[t.id] && <pre className="mt-1 overflow-auto rounded bg-slate-900 p-2 text-slate-100">{JSON.stringify(t.errorRaw, null, 2)}</pre>}
              </div>
            )}
            {logs.length > 0 && (
              <ol className="mt-3 space-y-1 border-l border-slate-200 pl-3 text-xs">
                {logs.map((l) => (
                  <li key={l.id} className={l.level === 'error' ? 'text-red-700' : l.level === 'warn' ? 'text-amber-700' : 'text-slate-600'}>
                    <span className="text-slate-400">{new Date(l.createdAt).toLocaleTimeString()}</span> {l.message}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )
      })}
    </div>
  )
}
