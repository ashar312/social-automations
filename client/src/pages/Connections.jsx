import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, PLATFORM_LABEL } from '../api.js'

const CONNECT_VIA = { linkedin: 'linkedin', youtube: 'youtube', facebook: 'meta', instagram: 'meta' }

function Badge({ c }) {
  if (c.status === 'disconnected') return <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Not connected</span>
  if (c.status === 'expired') return <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">Expired, reconnect</span>
  if (c.status === 'error') return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Error</span>
  const soon = c.daysLeft != null && c.daysLeft < 7
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${soon ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
      Connected{c.daysLeft != null ? ` · ${c.daysLeft}d left` : ' · no expiry'}
    </span>
  )
}

export default function Connections() {
  const [list, setList] = useState([])
  const [msg, setMsg] = useState({})
  const [params, setParams] = useSearchParams()
  const [pages, setPages] = useState(null)
  const flash = params.get('connected')
  const error = params.get('error')
  const sel = params.get('sel')

  const load = useCallback(() => api.get('/api/connections').then((d) => setList(d.connections)).catch(() => {}), [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (params.get('pick') === 'meta' && sel) {
      api.get(`/api/oauth/meta/pages?sel=${sel}`).then((d) => setPages(d.pages)).catch((e) => setMsg({ meta: e.message }))
    }
  }, [params, sel])

  async function test(p) {
    setMsg((m) => ({ ...m, [p]: 'Testing…' }))
    try { const r = await api.post(`/api/connections/${p}/test`); setMsg((m) => ({ ...m, [p]: r.message })) }
    catch (e) { setMsg((m) => ({ ...m, [p]: e.message })) }
    load()
  }
  async function disconnect(p) {
    if (!confirm(`Disconnect ${PLATFORM_LABEL[p]}?`)) return
    await api.del(`/api/connections/${p}`)
    load()
  }
  async function choose(pageId) {
    await api.post('/api/oauth/meta/select', { sel, pageId })
    setPages(null); setParams({ connected: 'facebook,instagram' }); load()
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Connections</h1>
      {flash && <p className="mb-3 rounded bg-green-50 p-3 text-sm text-green-800">Connected: {flash.replace(',', ' + ')}</p>}
      {error && <p className="mb-3 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {msg.meta && <p className="mb-3 rounded bg-red-50 p-3 text-sm text-red-800">{msg.meta}</p>}
      {pages && (
        <div className="mb-4 rounded border border-indigo-200 bg-indigo-50 p-4">
          <p className="mb-2 font-medium">Which Facebook Page should be used?</p>
          <div className="flex flex-wrap gap-2">
            {pages.map((p) => (
              <button key={p.id} onClick={() => choose(p.id)} className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700">{p.name}</button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {list.map((c) => {
          const connected = c.status !== 'disconnected'
          return (
            <div key={c.platform} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  {c.avatarUrl ? <img src={c.avatarUrl} alt="" className="h-10 w-10 rounded-full" referrerPolicy="no-referrer" /> : <div className="h-10 w-10 rounded-full bg-slate-200" />}
                  <div>
                    <div className="font-medium">{PLATFORM_LABEL[c.platform]}</div>
                    <div className="text-sm text-slate-500">{c.displayName || '—'}</div>
                  </div>
                </div>
                <Badge c={c} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                <a href={`/api/oauth/${CONNECT_VIA[c.platform]}/start`} className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700">
                  {connected ? 'Reconnect' : 'Connect'}
                </a>
                {connected && <button onClick={() => test(c.platform)} className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50">Test</button>}
                {connected && <button onClick={() => disconnect(c.platform)} className="rounded border border-slate-300 px-3 py-1.5 text-red-700 hover:bg-red-50">Disconnect</button>}
              </div>
              {msg[c.platform] && <p className="mt-2 text-sm text-slate-600">{msg[c.platform]}</p>}
              {c.platform === 'instagram' && !connected && <p className="mt-2 text-xs text-slate-500">Connected together with Facebook (same Meta login).</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
