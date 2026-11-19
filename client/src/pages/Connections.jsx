import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FaFlask, FaLink, FaLinkSlash, FaRotate } from 'react-icons/fa6'
import { api, PLATFORM_LABEL } from '../api.js'
import { Bar, Notice, PageTitle, PlatformIcon, PLATFORM_META } from '../components/ui.jsx'
import { useGame } from '../game/useGame.js'
import { useProject } from '../projects/useProject.js'

const CONNECT_VIA = { linkedin: 'linkedin', youtube: 'youtube', facebook: 'meta', instagram: 'meta' }
const TOKEN_FULL_DAYS = 60

function Badge({ c }) {
  if (c.status === 'disconnected') return <span className="pill pill-mute">Not connected</span>
  if (c.status === 'expired') return <span className="pill pill-bad">Expired, reconnect</span>
  if (c.status === 'error') return <span className="pill pill-warn">Error</span>
  const soon = c.daysLeft != null && c.daysLeft < 7
  return <span className={`pill ${soon ? 'pill-warn' : 'pill-good'}`}>Connected{c.daysLeft != null ? ` · ${c.daysLeft}d left` : ' · no expiry'}</span>
}

export default function Connections() {
  const { confirm, refresh } = useGame()
  const { active, projectApi, reload: reloadProjects } = useProject()
  const [list, setList] = useState([])
  const [msg, setMsg] = useState({})
  const [params, setParams] = useSearchParams()
  const [pages, setPages] = useState(null)
  const [liAccounts, setLiAccounts] = useState(null)
  const flash = params.get('connected')
  const error = params.get('error')
  const sel = params.get('sel')

  const load = useCallback(() => api.get(projectApi('/connections')).then((d) => setList(d.connections)).catch(() => {}), [projectApi])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (params.get('pick') === 'meta' && sel) {
      api.get(`/api/oauth/meta/pages?sel=${sel}`).then((d) => setPages(d.pages)).catch((e) => setMsg({ meta: e.message }))
    }
    if (params.get('pick') === 'linkedin' && sel) {
      api.get(`/api/oauth/linkedin/accounts?sel=${sel}`).then((d) => setLiAccounts(d.accounts)).catch((e) => setMsg({ meta: e.message }))
    }
  }, [params, sel])
  async function chooseLinkedin(id) {
    await api.post('/api/oauth/linkedin/select', { sel, id })
    setLiAccounts(null); setParams({ connected: 'linkedin' }); load(); refresh(); reloadProjects()
  }

  async function test(p) {
    setMsg((m) => ({ ...m, [p]: 'Testing…' }))
    try { const r = await api.post(projectApi(`/connections/${p}/test`)); setMsg((m) => ({ ...m, [p]: r.message })) }
    catch (e) { setMsg((m) => ({ ...m, [p]: e.message })) }
    load()
  }
  async function disconnect(p) {
    const sure = await confirm({ title: `Disconnect ${PLATFORM_LABEL[p]}?`, body: 'You can reconnect it at any time.', confirmLabel: 'Disconnect', danger: true })
    if (!sure) return
    await api.del(projectApi(`/connections/${p}`))
    load()
    refresh()
    reloadProjects()
  }
  async function choose(pageId) {
    await api.post('/api/oauth/meta/select', { sel, pageId })
    setPages(null); setParams({ connected: 'facebook,instagram' }); load(); refresh(); reloadProjects()
  }

  const linked = list.filter((c) => ['connected', 'error'].includes(c.status)).length

  return (
    <div>
      <PageTitle eyebrow={`Your party · ${active.name}`} title="Connections">
        {list.length > 0 && (
          <div className="w-full sm:w-56">
            <p className="mb-1 text-right text-sm font-extrabold tabular-nums"><span className="text-xp">{linked}</span>/{list.length} linked</p>
            <Bar pct={(linked / list.length) * 100} label="Platforms connected" />
          </div>
        )}
      </PageTitle>

      {(flash || error || msg.meta) && (
        <div className="mb-4 space-y-3">
          {flash && <Notice tone="good">Connected: {flash.replace(',', ' + ')}</Notice>}
          {error && <Notice>{error}</Notice>}
          {msg.meta && <Notice>{msg.meta}</Notice>}
        </div>
      )}

      {pages && (
        <div className="panel mb-5 p-5">
          <p className="panel-title mb-3">Which Facebook Page should be used?</p>
          <div className="flex flex-wrap gap-2">
            {pages.map((p) => <button key={p.id} onClick={() => choose(p.id)} className="btn btn-xp btn-sm">{p.name}{p.usedIn?.length > 0 && <span className="text-xs font-bold opacity-70"> · also in {p.usedIn.join(', ')}</span>}</button>)}
          </div>
        </div>
      )}

      {liAccounts && (
        <div className="panel mb-5 p-5">
          <p className="panel-title mb-3">Post to LinkedIn as…</p>
          <div className="flex flex-wrap gap-2">
            {liAccounts.map((a) => <button key={a.id} onClick={() => chooseLinkedin(a.id)} className="btn btn-xp btn-sm">{a.name}</button>)}
          </div>
        </div>
      )}

      {list.length === 0 && <div className="grid gap-5 sm:grid-cols-2" aria-label="Loading">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-52" />)}</div>}

      <div className="stagger grid gap-5 sm:grid-cols-2">
        {list.map((c, i) => {
          const connected = c.status !== 'disconnected'
          const healthy = ['connected', 'error'].includes(c.status)
          const color = PLATFORM_META[c.platform].color
          const soon = c.daysLeft != null && c.daysLeft < 7
          return (
            <div
              key={c.platform}
              style={{ '--i': i, '--pc': color, borderColor: healthy ? `color-mix(in srgb, ${color} 55%, var(--color-ink-700))` : undefined }}
              className="panel panel-hover p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative shrink-0">
                    <PlatformIcon platform={c.platform} size="lg" />
                    {c.avatarUrl && <img src={c.avatarUrl} alt="" referrerPolicy="no-referrer" className="absolute -bottom-1.5 -right-1.5 h-7 w-7 rounded-full border-2 border-ink-900 object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-display text-2xl leading-tight">{PLATFORM_LABEL[c.platform]}</div>
                    <div className="truncate text-sm text-ink-300">{c.displayName || '—'}</div>
                    {c.sharedWith?.length > 0 && <span className="pill pill-mute mt-1">Shared with: {c.sharedWith.join(', ')}</span>}
                  </div>
                </div>
                <Badge c={c} />
              </div>

              {healthy && (
                <div className="mt-4">
                  <p className="mb-1 text-xs font-extrabold text-ink-300">Token energy</p>
                  <Bar pct={c.daysLeft == null ? 100 : (c.daysLeft / TOKEN_FULL_DAYS) * 100} tone={soon ? 'bad' : 'platform'} label={`${PLATFORM_LABEL[c.platform]} token energy`} />
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-2.5">
                <a href={`/api/oauth/${CONNECT_VIA[c.platform]}/start?project=${active.id}`} className={`btn btn-sm ${connected ? 'btn-ghost' : 'btn-xp'}`}>
                  {connected ? <FaRotate aria-hidden="true" /> : <FaLink aria-hidden="true" />}{connected ? 'Reconnect' : 'Connect'}
                </a>
                {connected && <button onClick={() => test(c.platform)} className="btn btn-ghost btn-sm"><FaFlask aria-hidden="true" />Test</button>}
                {connected && <button onClick={() => disconnect(c.platform)} className="btn btn-ghost btn-sm !text-coral"><FaLinkSlash aria-hidden="true" />Disconnect</button>}
              </div>
              {msg[c.platform] && <p className="mt-3 text-sm font-bold text-ink-200" role="status">{msg[c.platform]}</p>}
              {c.platform === 'instagram' && !connected && <p className="mt-3 text-xs text-ink-300">Connected together with Facebook (same Meta login).</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
