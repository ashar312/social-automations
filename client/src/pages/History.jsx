import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaArrowLeft, FaArrowRight, FaBolt, FaCalendarDays, FaFileLines, FaImage, FaRocket, FaVideo } from 'react-icons/fa6'
import { api, PLATFORMS, PLATFORM_LABEL } from '../api.js'
import { PageTitle, PlatformIcon, PostStatus, TargetChip, postTone } from '../components/ui.jsx'
import { postXp } from '../game/engine.js'

const busy = (p) => ['queued', 'publishing'].includes(p.status)
const TYPE_ICON = { text: FaFileLines, image: FaImage, video: FaVideo, reel: FaVideo }

export default function History() {
  const [posts, setPosts] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [platform, setPlatform] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(() => {
    const q = new URLSearchParams({ page, ...(status && { status }), ...(platform && { platform }) })
    return api.get(`/api/posts?${q}`).then((d) => { setPosts(d.posts); setTotal(d.total) }).catch(() => {}).finally(() => setLoaded(true))
  }, [page, status, platform])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!posts.some(busy)) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [posts, load])

  const filtered = status || platform

  return (
    <div>
      <PageTitle eyebrow="Mission log" title="History" />

      <div className="mb-5 space-y-2.5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {['', 'queued', 'publishing', 'completed', 'partial', 'failed'].map((s) => (
            <button key={s || 'all'} aria-pressed={status === s} onClick={() => { setPage(1); setStatus(s) }} className="filter-pill">{s || 'All statuses'}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by platform">
          <button aria-pressed={platform === ''} onClick={() => { setPage(1); setPlatform('') }} className="filter-pill">All platforms</button>
          {PLATFORMS.map((p) => (
            <button key={p} aria-pressed={platform === p} onClick={() => { setPage(1); setPlatform(p) }} className="filter-pill"><PlatformIcon platform={p} size="xs" />{PLATFORM_LABEL[p]}</button>
          ))}
        </div>
      </div>

      {!loaded && <div className="space-y-3" aria-label="Loading">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-28" />)}</div>}

      {loaded && posts.length === 0 && (
        <div className="panel p-10 text-center">
          <FaRocket className="float-slow mx-auto mb-4 text-5xl text-xp" aria-hidden="true" />
          <h2 className="font-display text-2xl">{filtered ? 'No missions match these filters' : 'No posts yet'}</h2>
          <p className="mt-1 text-sm text-ink-300">{filtered ? 'Try a different status or platform.' : 'Your first launch earns the Liftoff trophy.'}</p>
          {!filtered && <Link to="/compose" className="btn btn-xp mt-5">Create your first post</Link>}
        </div>
      )}

      <ul className="stagger space-y-3">
        {posts.map((p, i) => {
          const TypeIcon = TYPE_ICON[p.contentType] || FaFileLines
          const xp = postXp(p)
          return (
            <li key={p.id} style={{ '--i': i }} className={`panel panel-hover mission mission-${postTone(p.status)} flex gap-4 p-3 sm:p-4`}>
              <Link to={`/history/${p.id}`} className="relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-ink-800 text-2xl text-ink-300" aria-label={`Open post ${p.id}`}>
                <TypeIcon aria-hidden="true" />
                {p.thumbnailMediaId && <img src={`/api/media/${p.thumbnailMediaId}/thumb`} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/history/${p.id}`} className="block min-w-0 truncate font-extrabold hover:text-xp">{p.title || p.caption || `(${p.contentType})`}</Link>
                  {xp > 0 && <span className="xp-tag"><FaBolt className="text-sm" aria-hidden="true" />+{xp}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-300">
                  <PostStatus status={p.status} />
                  <span>#{p.id}</span>
                  <span className="capitalize">{p.contentType}</span>
                  <span>{new Date(p.createdAt).toLocaleString()}</span>
                  {p.scheduledAt && new Date(p.scheduledAt) > new Date() && <span className="inline-flex items-center gap-1 font-bold text-grape"><FaCalendarDays aria-hidden="true" />Scheduled {new Date(p.scheduledAt).toLocaleString()}</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">{p.targets.map((t) => <TargetChip key={t.id} t={t} />)}</div>
              </div>
            </li>
          )
        })}
      </ul>

      {total > 20 && (
        <div className="mt-6 flex items-center justify-center gap-4 text-sm font-extrabold">
          <button disabled={page === 1} onClick={() => setPage(page - 1)} className="btn btn-ghost btn-sm"><FaArrowLeft aria-hidden="true" />Prev</button>
          <span className="tabular-nums">Page {page} of {Math.ceil(total / 20)}</span>
          <button disabled={page * 20 >= total} onClick={() => setPage(page + 1)} className="btn btn-ghost btn-sm">Next<FaArrowRight aria-hidden="true" /></button>
        </div>
      )}
    </div>
  )
}
