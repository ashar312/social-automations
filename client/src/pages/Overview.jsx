import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaArrowRight, FaCircleCheck, FaLayerGroup, FaPaperPlane, FaPenNib, FaRegCalendar } from 'react-icons/fa6'
import { api, PLATFORMS, PLATFORM_LABEL } from '../api.js'
import { Bar, PageTitle, PlatformIcon, PostStatus, TargetChip, PLATFORM_META } from '../components/ui.jsx'
import { useProject } from '../projects/useProject.js'

const WEEKS = 14

const dayKey = (value) => {
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function fetchPosts(base) {
  const posts = []
  for (let page = 1; ; page += 1) {
    const d = await api.get(`${base}?page=${page}&limit=50`)
    posts.push(...d.posts)
    if (!d.posts.length || posts.length >= d.total) return posts
  }
}

function summarize(posts) {
  const perPlatform = Object.fromEntries(PLATFORMS.map((p) => [p, 0]))
  const byDay = {}
  let published = 0
  let attempted = 0
  let last7 = 0
  const weekAgo = Date.now() - 7 * 86400000
  for (const post of posts) {
    let live = 0
    for (const t of post.targets) {
      if (t.status === 'published') { live += 1; perPlatform[t.platform] += 1 }
      if (['published', 'failed'].includes(t.status)) attempted += 1
    }
    if (!live) continue
    published += live
    const when = post.targets.map((t) => t.finishedAt).filter(Boolean).sort()[0] || post.createdAt
    const key = dayKey(when)
    byDay[key] = (byDay[key] || 0) + live
    if (new Date(when).getTime() >= weekAgo) last7 += 1
  }
  return {
    posts: posts.length,
    published,
    last7,
    successRate: attempted ? Math.round((published / attempted) * 100) : null,
    perPlatform,
    byDay,
  }
}

function Heatmap({ byDay }) {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - today.getDay() - (WEEKS - 1) * 7)
  const cells = Array.from({ length: WEEKS * 7 }, (_, i) => {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    const key = dayKey(date)
    return { key, date, count: byDay[key] || 0, future: date > today, today: key === dayKey(today) }
  })
  return (
    <div className="grid grid-flow-col grid-rows-7 gap-1" role="img" aria-label={`Publishing activity for the last ${WEEKS} weeks`}>
      {cells.map((c) => (
        <div
          key={c.key}
          title={c.future ? undefined : `${c.date.toLocaleDateString()}: ${c.count} published`}
          className={`heat ${c.future ? 'heat-future' : c.count ? `heat-${Math.min(c.count, 4)}` : ''} ${c.today ? 'heat-today' : ''}`}
        />
      ))}
    </div>
  )
}

function Stat({ icon: Icon, label, value, hint, index }) {
  return (
    <div style={{ '--i': index }} className="card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className="stat-icon"><Icon aria-hidden="true" /></span>
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </div>
  )
}

export default function Overview() {
  const { active, projectApi } = useProject()
  const [posts, setPosts] = useState(null)

  useEffect(() => {
    let live = true
    fetchPosts(projectApi('/posts')).then((p) => { if (live) setPosts(p) }).catch(() => { if (live) setPosts([]) })
    return () => { live = false }
  }, [projectApi])

  const stats = useMemo(() => (posts ? summarize(posts) : null), [posts])

  if (!stats) {
    return (
      <div>
        <PageTitle eyebrow={active.name} title="Overview" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Loading">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-32" />)}</div>
        <div className="skeleton mt-5 h-64" />
      </div>
    )
  }

  const maxPlatform = Math.max(1, ...Object.values(stats.perPlatform))
  const recent = posts.slice(0, 5)

  return (
    <div>
      <PageTitle eyebrow={active.name} title="Overview">
        <Link to="/compose" className="btn btn-primary"><FaPenNib aria-hidden="true" />New post</Link>
      </PageTitle>

      <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat index={0} icon={FaLayerGroup} label="Total posts" value={stats.posts.toLocaleString()} hint="Created in this project" />
        <Stat index={1} icon={FaPaperPlane} label="Published" value={stats.published.toLocaleString()} hint="Platform publishes" />
        <Stat index={2} icon={FaCircleCheck} label="Success rate" value={stats.successRate == null ? '—' : `${stats.successRate}%`} hint="Published vs. failed" />
        <Stat index={3} icon={FaRegCalendar} label="Last 7 days" value={stats.last7.toLocaleString()} hint="Posts that went live" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="card p-5">
          <h2 className="card-title mb-4">Publishing activity</h2>
          <Heatmap byDay={stats.byDay} />
          <p className="mt-3 text-xs text-muted">Platform publishes per day over the last {WEEKS} weeks.</p>
        </section>

        <section className="card p-5">
          <h2 className="card-title mb-4">By platform</h2>
          <ul className="space-y-4">
            {PLATFORMS.map((p) => (
              <li key={p} style={{ '--pc': PLATFORM_META[p].color }} className="flex items-center gap-3">
                <PlatformIcon platform={p} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-ink">{PLATFORM_LABEL[p]}</span>
                    <span className="text-xs font-medium tabular-nums text-muted">{stats.perPlatform[p]}</span>
                  </div>
                  <Bar pct={(stats.perPlatform[p] / maxPlatform) * 100} tone="platform" size="sm" label={`${PLATFORM_LABEL[p]} publishes`} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card mt-5 p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="card-title">Recent posts</h2>
          {recent.length > 0 && <Link to="/history" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-strong hover:underline">View all<FaArrowRight className="text-xs" aria-hidden="true" /></Link>}
        </div>
        {recent.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line-strong p-8 text-center">
            <p className="font-semibold text-ink">No posts yet</p>
            <p className="mt-1 text-sm text-muted">Compose your first post to see activity here.</p>
            <Link to="/compose" className="btn btn-primary mt-4">Create a post</Link>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <Link to={`/history/${p.id}`} className="block truncate text-sm font-medium text-ink hover:text-brand-strong">{p.title || p.caption || `(${p.contentType})`}</Link>
                  <p className="mt-0.5 text-xs text-muted">{new Date(p.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {p.targets.map((t) => <TargetChip key={t.id} t={t} />)}
                  <PostStatus status={p.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
