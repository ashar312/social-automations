import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, uploadMedia, PLATFORMS, PLATFORM_LABEL } from '../api.js'

const LIMITS = { linkedin: 3000, instagram: 2200, youtube: 5000, facebook: null }

function suggestType(media) {
  if (!media.length) return 'text'
  const v = media.find((m) => m.kind === 'video')
  if (!v) return 'image'
  return v.width && v.height && v.height / v.width >= 1.5 && v.duration <= 180 ? 'reel' : 'video'
}

export default function Compose() {
  const nav = useNavigate()
  const fileRef = useRef(null)
  const [media, setMedia] = useState([])
  const [uploads, setUploads] = useState([]) // {name, pct, error}
  const [contentType, setContentType] = useState('text')
  const [typeTouched, setTypeTouched] = useState(false)
  const [caption, setCaption] = useState('')
  const [title, setTitle] = useState('')
  const [overrides, setOverrides] = useState({ linkedin: {}, youtube: { privacy: 'public' }, facebook: {}, instagram: { shareToFeed: true } })
  const [tab, setTab] = useState('default')
  const [deselected, setDeselected] = useState(new Set())
  const [conns, setConns] = useState({})
  const [config, setConfig] = useState({})
  const [results, setResults] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(false)
  const [schedule, setSchedule] = useState('')

  useEffect(() => {
    api.get('/api/connections').then((d) => setConns(Object.fromEntries(d.connections.map((c) => [c.platform, c])))).catch(() => {})
    api.get('/api/config').then(setConfig).catch(() => {})
  }, [])

  useEffect(() => { if (!typeTouched) setContentType(suggestType(media)) }, [media, typeTouched])

  const connected = (p) => conns[p] && ['connected', 'error'].includes(conns[p].status)

  // live validation (debounced) against all platforms so we know what is supported
  const payloadBase = useMemo(() => ({
    contentType, caption, title: title || null, mediaIds: media.map((m) => m.id),
  }), [contentType, caption, title, media])

  useEffect(() => {
    const t = setTimeout(() => {
      api.post('/api/posts/validate', {
        ...payloadBase,
        targets: PLATFORMS.map((p) => ({ platform: p, overrides: cleanOverrides(overrides[p]) })),
      }).then((d) => setResults(d.results)).catch((e) => setError(e.message))
    }, 350)
    return () => clearTimeout(t)
  }, [payloadBase, overrides])

  const selectable = (p) => results[p]?.supported !== false && connected(p)
  const selected = PLATFORMS.filter((p) => selectable(p) && !deselected.has(p))
  const blockers = selected.flatMap((p) => (results[p]?.errors || []).map((e) => `${PLATFORM_LABEL[p]}: ${e}`))

  async function addFiles(files) {
    setError('')
    for (const f of files) {
      const u = { name: f.name, pct: 0 }
      setUploads((l) => [...l, u])
      try {
        const m = await uploadMedia(f, (pct) => setUploads((l) => l.map((x) => (x === u ? { ...x, pct } : x))))
        setMedia((cur) => {
          // a video replaces everything; images can be many but not mixed with a video
          if (m.kind === 'video') return [m]
          return [...cur.filter((x) => x.kind === 'image'), m]
        })
      } catch (e) {
        setUploads((l) => l.map((x) => (x === u ? { ...x, error: e.message } : x)))
        continue
      }
      setUploads((l) => l.filter((x) => x !== u))
    }
  }

  const setOv = (p, k, v) => setOverrides((o) => ({ ...o, [p]: { ...o[p], [k]: v } }))
  function cleanOverrides(o) {
    const out = {}
    for (const [k, v] of Object.entries(o || {})) if (v !== '' && v != null) out[k] = v
    return Object.keys(out).length ? out : null
  }

  async function publish() {
    setBusy(true); setError('')
    try {
      const r = await api.post('/api/posts', {
        ...payloadBase,
        targets: PLATFORMS.filter((p) => selected.includes(p) || (results[p]?.supported === false && connected(p)))
          .map((p) => ({ platform: p, overrides: cleanOverrides(overrides[p]) })),
        publishNow: !schedule,
        scheduledAt: schedule ? new Date(schedule).toISOString() : undefined,
      })
      nav(`/history/${r.id}`)
    } catch (e) {
      setError(e.message)
      if (e.data?.results) setResults(e.data.results)
    } finally { setBusy(false) }
  }

  const primary = media[0]
  const capFor = (p) => (overrides[p]?.caption ?? caption)

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Compose</h1>

        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles([...e.dataTransfer.files]) }}
          onClick={() => fileRef.current?.click()}
          className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center text-sm ${drag ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white'}`}
        >
          <input ref={fileRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.mp4,.mov" hidden onChange={(e) => { addFiles([...e.target.files]); e.target.value = '' }} />
          Drop an image / video here, or click to choose. Leave empty for a text-only post.
        </div>

        {uploads.map((u, i) => (
          <div key={i} className="text-sm">
            <div className="flex justify-between"><span>{u.name}</span><span>{u.error ? '' : `${u.pct}%`}</span></div>
            {u.error ? <p className="text-red-600">{u.error}</p> : <div className="h-2 rounded bg-slate-200"><div className="h-2 rounded bg-indigo-600" style={{ width: `${u.pct}%` }} /></div>}
          </div>
        ))}

        {media.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {media.map((m) => (
              <div key={m.id} className="relative">
                {m.kind === 'video' && media.length === 1
                  ? <video src={`/api/media/${m.id}/file`} controls className="max-h-72 rounded" />
                  : <img src={`/api/media/${m.id}/thumb`} alt={m.name} className="h-32 rounded" />}
                <button onClick={() => setMedia((c) => c.filter((x) => x.id !== m.id))} className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-slate-800 text-xs text-white">×</button>
              </div>
            ))}
          </div>
        )}
        {primary && (
          <p className="text-xs text-slate-500">
            {primary.kind} · {primary.width}×{primary.height}{primary.duration != null ? ` · ${primary.duration.toFixed(1)}s` : ''} · {(primary.size / 1048576).toFixed(1)} MB
          </p>
        )}

        <div className="flex items-center gap-3 text-sm">
          <label className="text-slate-600">Content type</label>
          <select value={contentType} onChange={(e) => { setContentType(e.target.value); setTypeTouched(true) }} className="rounded border border-slate-300 bg-white px-2 py-1">
            <option value="text">Text</option><option value="image">Image(s)</option><option value="video">Video</option><option value="reel">Reel / Short</option>
          </select>
          {!typeTouched && media.length > 0 && <span className="text-xs text-slate-500">auto-detected</span>}
        </div>

        <div className="flex gap-1 border-b border-slate-200 text-sm">
          {['default', ...PLATFORMS].map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 ${tab === t ? 'border-b-2 border-indigo-600 font-medium text-indigo-600' : 'text-slate-600'}`}>
              {t === 'default' ? 'Default' : PLATFORM_LABEL[t]}
            </button>
          ))}
        </div>

        {tab === 'default' ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm text-slate-600">Caption (used everywhere unless overridden)</label>
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={6} className="w-full rounded border border-slate-300 bg-white p-2" />
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
                {PLATFORMS.filter((p) => LIMITS[p]).map((p) => (
                  <span key={p} className={capFor(p).length > LIMITS[p] ? 'font-medium text-red-600' : ''}>{PLATFORM_LABEL[p]} {capFor(p).length}/{LIMITS[p]}</span>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">Title (YouTube, max 100)</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded border border-slate-300 bg-white p-2" />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm text-slate-600">Caption override for {PLATFORM_LABEL[tab]} (empty = use default)</label>
              <textarea value={overrides[tab].caption || ''} onChange={(e) => setOv(tab, 'caption', e.target.value)} rows={4} className="w-full rounded border border-slate-300 bg-white p-2" />
            </div>
            {tab === 'youtube' && (
              <>
                <input placeholder="Title override" value={overrides.youtube.title || ''} onChange={(e) => setOv('youtube', 'title', e.target.value)} className="w-full rounded border border-slate-300 bg-white p-2" />
                <div className="flex items-center gap-3 text-sm">
                  <label>Privacy</label>
                  <select value={overrides.youtube.privacy} onChange={(e) => setOv('youtube', 'privacy', e.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1">
                    <option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option>
                  </select>
                  {config.youtubeAudited === false && <span className="text-xs text-amber-700">Audit not passed: uploads will be private</span>}
                </div>
                <input placeholder="Tags (comma separated)" value={overrides.youtube.tags || ''} onChange={(e) => setOv('youtube', 'tags', e.target.value)} className="w-full rounded border border-slate-300 bg-white p-2" />
              </>
            )}
            {tab === 'instagram' && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={overrides.instagram.shareToFeed !== false} onChange={(e) => setOv('instagram', 'shareToFeed', e.target.checked)} /> Also share Reel to feed
              </label>
            )}
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-medium">Publish to</h2>
          <ul className="space-y-3">
            {PLATFORMS.map((p) => {
              const r = results[p]
              const ok = selectable(p)
              const why = r?.supported === false ? r.reason : !connected(p) ? 'Not connected' : null
              return (
                <li key={p} title={why || ''} className={ok ? '' : 'opacity-50'}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" disabled={!ok} checked={ok && !deselected.has(p)} onChange={(e) => setDeselected((s) => { const n = new Set(s); e.target.checked ? n.delete(p) : n.add(p); return n })} />
                    <span className="font-medium">{PLATFORM_LABEL[p]}</span>
                  </label>
                  {why && <p className="ml-6 text-xs text-slate-500">{why}</p>}
                  {ok && !deselected.has(p) && r?.errors.map((e, i) => <p key={i} className="ml-6 text-xs text-red-600">{e}</p>)}
                  {ok && !deselected.has(p) && r?.warnings.map((e, i) => <p key={i} className="ml-6 text-xs text-amber-700">{e}</p>)}
                </li>
              )
            })}
          </ul>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <label className="mb-1 block text-slate-600">Schedule (optional)</label>
          <input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} className="w-full rounded border border-slate-300 p-1" />
        </div>

        {error && <p className="rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <button
          onClick={publish}
          disabled={busy || !selected.length || blockers.length > 0 || uploads.some((u) => !u.error)}
          className="w-full rounded bg-indigo-600 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? 'Submitting…' : schedule ? 'Schedule' : `Publish to ${selected.length} platform${selected.length === 1 ? '' : 's'}`}
        </button>
      </aside>
    </div>
  )
}
