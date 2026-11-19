import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaArrowLeft, FaArrowRight, FaCalendarDays, FaFileLines, FaImage, FaInbox, FaVideo } from 'react-icons/fa6'
import { api, PLATFORMS, PLATFORM_LABEL } from '../api.js'
import { PageTitle, PlatformIcon, PostStatus, TargetChip, ViaBadge, postTone } from '../components/ui.jsx'
import { useProject } from '../projects/useProject.js'

const busy = (p) => ['queued', 'publishing'].includes(p.status)
const TYPE_ICON = { text: FaFileLines, image: FaImage, video: FaVideo, reel: FaVideo }

export default function History() {
  const { active, projects, projectApi } = useProject()
  const [allProjects, setAllProjects] = useState(false)
  const [posts, setPosts] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [platform, setPlatform] = useState('')
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(() => {
    const q = new URLSearchParams({ page, ...(status && { status }), ...(platform && { platform }) })
    return api.get(`${allProjects ? '/api/posts' : projectApi('/posts')}?${q}`).then((d) => { setPosts(d.posts); setTotal(d.total) }).catch(() => {}).finally(() => setLoaded(true))
  }, [page, status, platform, projectApi, allProjects])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!posts.some(busy)) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [posts, load])

  const filtered = status || platform

  return (
    <div>
      <PageTitle eyebrow={`${allProjects ? 'All projects' : active.name}`} title="History">
        {projects.filter((p) => !p.archived).length > 1 && (
          <button aria-pressed={allProjects} onClick={() => { setPage(1); setAllProjects((v) => !v) }} className="filter-pill">All projects</button>
        )}
      </PageTitle>

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
        <div className="card p-12 text-center">
          <span className="stat-icon mx-auto mb-4 !h-12 !w-12 !text-lg"><FaInbox aria-hidden="true" /></span>
          <h2 className="text-lg font-semibold">{filtered ? 'No posts match these filters' : 'No posts yet'}</h2>
          <p className="mt-1 text-sm text-muted">{filtered ? 'Try a different status or platform.' : 'Create your first post to see it here.'}</p>
          {!filtered && <Link to="/compose" className="btn btn-primary mt-5">Create your first post</Link>}
        </div>
      )}

      <ul className="stagger space-y-3">
        {posts.map((p, i) => {
          const TypeIcon = TYPE_ICON[p.contentType] || FaFileLines
          return (
            <li key={p.id} style={{ '--i': i }} className={`card card-hover status-bar tone-${postTone(p.status)} flex gap-4 p-3 sm:p-4`}>
              <Link to={`/history/${p.id}`} className="relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-sunken text-xl text-muted" aria-label={`Open post ${p.id}`}>
                <TypeIcon aria-hidden="true" />
                {p.thumbnailMediaId && <img src={`/api/media/${p.thumbnailMediaId}/thumb`} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/history/${p.id}`} className="block min-w-0 truncate font-semibold text-ink hover:text-brand-strong">{p.title || p.caption || `(${p.contentType})`}</Link>
                  {allProjects && (() => { const pr = projects.find((x) => x.id === p.projectId); return pr && <span className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-muted"><span className="h-2 w-2 rounded-full" style={{ background: pr.color }} aria-hidden="true" />{pr.name}</span> })()}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <PostStatus status={p.status} />
                  <span>#{p.id}</span>
                  <span className="capitalize">{p.contentType}</span>
                  <span>{new Date(p.createdAt).toLocaleString()}</span>
                  <ViaBadge via={p.createdVia} />
                  {p.scheduledAt && new Date(p.scheduledAt) > new Date() && <span className="inline-flex items-center gap-1 font-medium text-brand"><FaCalendarDays aria-hidden="true" />Scheduled {new Date(p.scheduledAt).toLocaleString()}</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">{p.targets.map((t) => <TargetChip key={t.id} t={t} />)}</div>
              </div>
            </li>
          )
        })}
      </ul>

      {total > 20 && (
        <div className="mt-6 flex items-center justify-center gap-4 text-sm font-semibold">
          <button disabled={page === 1} onClick={() => setPage(page - 1)} className="btn btn-sm"><FaArrowLeft aria-hidden="true" />Prev</button>
          <span className="tabular-nums">Page {page} of {Math.ceil(total / 20)}</span>
          <button disabled={page * 20 >= total} onClick={() => setPage(page + 1)} className="btn btn-sm">Next<FaArrowRight aria-hidden="true" /></button>
        </div>
      )}
    </div>
  )
}
