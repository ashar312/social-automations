import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FaArrowLeft, FaArrowRotateRight, FaArrowUpRightFromSquare, FaTrash } from 'react-icons/fa6'
import { api, PLATFORM_LABEL } from '../api.js'
import { Bar, Notice, PlatformIcon, PostStatus, TargetStatus, postTone, PLATFORM_META } from '../components/ui.jsx'
import { useConfirm } from '../components/useConfirm.js'
import { useProject } from '../projects/useProject.js'

const HEADLINE = {
  completed: 'Published',
  partial: 'Partially published',
  failed: 'Publishing failed',
  publishing: 'Publishing…',
  queued: 'Queued',
  draft: 'Draft',
}

export default function PostDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const confirm = useConfirm()
  const { projects, active: activeProject, setActive } = useProject()
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
    const remote = post.targets.some((t) => t.status === 'published') && await confirm({
      title: 'Also delete from the platforms?',
      body: 'Removes the live post where the API allows it (not Instagram).',
      confirmLabel: 'Yes, delete live posts',
      cancelLabel: 'No, keep them live',
      danger: true,
    })
    const sure = await confirm({
      title: 'Delete this post from history?',
      body: 'This removes the record from your history. Posts already live on the platforms are not affected.',
      confirmLabel: 'Delete post',
      danger: true,
    })
    if (!sure) return
    await api.del(`/api/posts/${id}${remote ? '?remote=true' : ''}`)
    nav('/history')
  }

  if (error) return <Notice>{error}</Notice>
  if (!post) return <div className="space-y-4" aria-label="Loading"><div className="skeleton h-36" /><div className="skeleton h-44" /></div>

  const live = post.targets.filter((t) => t.status === 'published').length
  const active = post.targets.filter((t) => t.status !== 'skipped').length

  return (
    <div className="space-y-5">
      <Link to="/history" className="inline-flex items-center gap-2 text-sm font-medium text-muted hover:text-ink"><FaArrowLeft aria-hidden="true" />History</Link>

      <section className={`card status-bar tone-${postTone(post.status)} p-5 sm:p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">Post #{post.id} · {post.contentType}</p>
            {post.projectId !== activeProject.id && (
              <p className="mb-1 text-xs font-medium text-body">
                In project {projects.find((p) => p.id === post.projectId)?.name || post.projectId}{' '}
                <button onClick={() => setActive(post.projectId)} className="font-semibold text-brand-strong underline">Switch</button>
              </p>
            )}
            <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">{HEADLINE[post.status] || post.status}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PostStatus status={post.status} />
              <span className="text-sm font-medium text-body">{live}/{active} platforms live</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={remove} className="btn btn-danger btn-sm"><FaTrash aria-hidden="true" />Delete</button>
          </div>
        </div>
        {post.caption && <p className="mt-4 whitespace-pre-wrap break-words rounded-2xl bg-sunken/70 p-3.5 text-sm text-ink">{post.caption}</p>}
        {post.media.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-3">
            {post.media.map((m) => <img key={m.id} src={`/api/media/${m.id}/thumb`} alt="" className="h-28 rounded-xl border border-line" onError={(e) => { e.currentTarget.style.display = 'none' }} />)}
          </div>
        )}
      </section>

      <div className="stagger space-y-4">
        {post.targets.map((t, i) => {
          const logs = post.logs.filter((l) => l.targetId === t.id)
          return (
            <section key={t.id} style={{ '--i': i, '--pc': PLATFORM_META[t.platform].color }} className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <PlatformIcon platform={t.platform} />
                  <div>
                    <h2 className="text-base font-semibold leading-tight text-ink">{PLATFORM_LABEL[t.platform]}</h2>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      <TargetStatus status={t.status} />
                      {t.attempts > 0 && <span>{t.attempts} attempt(s)</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  {t.externalUrl && <a href={t.externalUrl} target="_blank" rel="noreferrer" className="btn btn-sm">Open post<FaArrowUpRightFromSquare aria-hidden="true" /></a>}
                  {t.status === 'failed' && <button onClick={() => retry(t.platform)} className="btn  btn-sm"><FaArrowRotateRight aria-hidden="true" />Retry</button>}
                </div>
              </div>
              {['uploading', 'processing'].includes(t.status) && (
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1"><Bar pct={t.progress} tone="platform" label={`${PLATFORM_LABEL[t.platform]} progress`} /></div>
                  <span className="text-sm font-semibold tabular-nums">{t.progress}%</span>
                </div>
              )}
              {t.errorMessage && <div className="mt-3"><Notice tone={t.status === 'skipped' ? 'warn' : 'bad'}>{t.errorMessage}</Notice></div>}
              {t.errorRaw && (
                <div className="mt-2 text-xs">
                  <button onClick={() => setRaw((r) => ({ ...r, [t.id]: !r[t.id] }))} className="font-medium text-muted underline hover:text-ink">{raw[t.id] ? 'Hide' : 'Show'} raw error</button>
                  {raw[t.id] && <pre className="mt-2 overflow-auto rounded-xl bg-sunken p-3 text-body">{JSON.stringify(t.errorRaw, null, 2)}</pre>}
                </div>
              )}
              {logs.length > 0 && (
                <ol className="timeline space-y-0.5">
                  {logs.map((l) => (
                    <li key={l.id} className={l.level === 'error' ? 'text-bad' : l.level === 'warn' ? 'text-warn' : 'text-body'}>
                      <span className="tabular-nums text-muted">{new Date(l.createdAt).toLocaleTimeString()}</span> {l.message}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
