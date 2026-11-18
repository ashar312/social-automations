import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, PLATFORMS, PLATFORM_LABEL } from '../api.js'

export const ICON = { published: '✅', pending: '⏳', uploading: '⏫', processing: '⚙️', failed: '❌', skipped: '⏭' }

export function Chip({ t }) {
  const inner = <span title={t.errorMessage || t.status}>{ICON[t.status]} {PLATFORM_LABEL[t.platform]}{['uploading', 'processing'].includes(t.status) ? ` ${t.progress}%` : ''}</span>
  const cls = 'rounded bg-slate-100 px-2 py-0.5 text-xs'
  return t.externalUrl
    ? <a href={t.externalUrl} target="_blank" rel="noreferrer" className={`${cls} hover:bg-slate-200`}>{inner}</a>
    : <span className={cls}>{inner}</span>
}

const busy = (p) => ['queued', 'publishing'].includes(p.status)

export default function History() {
  const [posts, setPosts] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [platform, setPlatform] = useState('')

  const load = useCallback(() => {
    const q = new URLSearchParams({ page, ...(status && { status }), ...(platform && { platform }) })
    return api.get(`/api/posts?${q}`).then((d) => { setPosts(d.posts); setTotal(d.total) }).catch(() => {})
  }, [page, status, platform])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!posts.some(busy)) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [posts, load])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">History</h1>
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }} className="rounded border border-slate-300 bg-white px-2 py-1 text-sm">
          <option value="">All statuses</option>
          {['queued', 'publishing', 'completed', 'partial', 'failed'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={platform} onChange={(e) => { setPage(1); setPlatform(e.target.value) }} className="rounded border border-slate-300 bg-white px-2 py-1 text-sm">
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
        </select>
      </div>

      {posts.length === 0 && <p className="text-slate-500">No posts yet.</p>}
      <ul className="space-y-3">
        {posts.map((p) => (
          <li key={p.id} className="flex gap-4 rounded-lg border border-slate-200 bg-white p-3">
            <Link to={`/history/${p.id}`} className="h-16 w-16 shrink-0 overflow-hidden rounded bg-slate-100">
              {p.thumbnailMediaId && <img src={`/api/media/${p.thumbnailMediaId}/thumb`} alt="" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
            </Link>
            <div className="min-w-0 flex-1">
              <Link to={`/history/${p.id}`} className="block truncate font-medium hover:underline">{p.title || p.caption || `(${p.contentType})`}</Link>
              <div className="text-xs text-slate-500">
                #{p.id} · {p.contentType} · {new Date(p.createdAt).toLocaleString()} · <b>{p.status}</b>
                {p.scheduledAt && new Date(p.scheduledAt) > new Date() && ` · scheduled ${new Date(p.scheduledAt).toLocaleString()}`}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">{p.targets.map((t) => <Chip key={t.id} t={t} />)}</div>
            </div>
          </li>
        ))}
      </ul>
      {total > 20 && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <button disabled={page === 1} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 disabled:opacity-40">Prev</button>
          <span>Page {page} of {Math.ceil(total / 20)}</span>
          <button disabled={page * 20 >= total} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  )
}
