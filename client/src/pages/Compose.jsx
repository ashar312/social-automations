import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FaBolt, FaCalendarDays, FaCheck, FaCloudArrowUp, FaRocket, FaXmark } from 'react-icons/fa6'
import { api, uploadMedia, PLATFORMS, PLATFORM_LABEL } from '../api.js'
import { Bar, CountUp, Notice, PageTitle, PlatformIcon, PLATFORM_META } from '../components/ui.jsx'
import { prefersReducedMotion } from '../game/confetti.js'
import { previewXp } from '../game/engine.js'

const LIMITS = { linkedin: 3000, instagram: 2200, youtube: 5000, facebook: null }
const LAUNCH_MS = 950

function suggestType(media) {
  if (!media.length) return 'text'
  const v = media.find((m) => m.kind === 'video')
  if (!v) return 'image'
  return v.width && v.height && v.height / v.width >= 1.5 && v.duration <= 180 ? 'reel' : 'video'
}

export default function Compose() {
  const nav = useNavigate()
  const fileRef = useRef(null)
  const launchTimer = useRef(null)
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
  const [launching, setLaunching] = useState(false)

  useEffect(() => () => clearTimeout(launchTimer.current), [])

  useEffect(() => {
    api.get('/api/connections').then((d) => setConns(Object.fromEntries(d.connections.map((c) => [c.platform, c])))).catch(() => {})
    api.get('/api/config').then(setConfig).catch(() => {})
  }, [])

  useEffect(() => { if (!typeTouched) setContentType(suggestType(media)) }, [media, typeTouched])

  const connected = (p) => Boolean(conns[p]) && ['connected', 'error'].includes(conns[p].status)

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
      const u = { id: crypto.randomUUID(), name: f.name, pct: 0 }
      setUploads((l) => [...l, u])
      try {
        const m = await uploadMedia(f, (pct) => setUploads((l) => l.map((x) => (x.id === u.id ? { ...x, pct } : x))))
        setMedia((cur) => {
          // a video replaces everything; images can be many but not mixed with a video
          if (m.kind === 'video') return [m]
          return [...cur.filter((x) => x.kind === 'image'), m]
        })
      } catch (e) {
        setUploads((l) => l.map((x) => (x.id === u.id ? { ...x, error: e.message } : x)))
        continue
      }
      setUploads((l) => l.filter((x) => x.id !== u.id))
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
      if (prefersReducedMotion()) nav(`/history/${r.id}`)
      else {
        setLaunching(true)
        launchTimer.current = setTimeout(() => nav(`/history/${r.id}`), LAUNCH_MS)
      }
    } catch (e) {
      setError(e.message)
      if (e.data?.results) setResults(e.data.results)
    } finally { setBusy(false) }
  }

  const primary = media[0]
  const capFor = (p) => (overrides[p]?.caption ?? caption)
  const uploading = uploads.some((u) => !u.error)
  const checks = [
    { label: 'Add content', done: caption.trim().length > 0 || media.length > 0 },
    { label: 'Pick a platform', done: selected.length > 0 },
    { label: 'Clear errors', done: selected.length > 0 && blockers.length === 0 },
    { label: 'Finish uploads', done: !uploading },
  ]
  const readiness = (checks.filter((c) => c.done).length / checks.length) * 100
  const reward = previewXp(contentType, selected.length)

  return (
    <div>
      <PageTitle eyebrow="New mission" title="Compose" />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_350px]">
        <div className="min-w-0 space-y-5">
          <section className="panel p-4 sm:p-5">
            <h2 className="panel-title mb-3"><span className="step-num">1</span>Load your media</h2>
            <button
              type="button"
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles([...e.dataTransfer.files]) }}
              onClick={() => fileRef.current?.click()}
              className={`dropzone ${drag ? 'dropzone-on' : ''}`}
            >
              <span className="dropzone-icon"><FaCloudArrowUp aria-hidden="true" /></span>
              <span className="mt-2 block font-extrabold">Drop an image or video here, or click to choose</span>
              <span className="block text-xs text-ink-300">Leave empty for a text-only post</span>
            </button>
            <input ref={fileRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.mp4,.mov" hidden onChange={(e) => { addFiles([...e.target.files]); e.target.value = '' }} />

            {uploads.length > 0 && (
              <div className="mt-3 space-y-2.5">
                {uploads.map((u) => (
                  <div key={u.id} className="text-sm">
                    <div className="mb-1 flex justify-between gap-3 font-bold"><span className="truncate">{u.name}</span><span className="tabular-nums text-xp">{u.error ? '' : `${u.pct}%`}</span></div>
                    {u.error ? <Notice>{u.error}</Notice> : <Bar pct={u.pct} label={`Uploading ${u.name}`} />}
                  </div>
                ))}
              </div>
            )}

            {media.length > 0 && (
              <div className="stagger mt-4 flex flex-wrap gap-3">
                {media.map((m) => (
                  <div key={m.id} className="relative">
                    {m.kind === 'video' && media.length === 1
                      ? <video src={`/api/media/${m.id}/file`} controls className="max-h-72 rounded-xl" />
                      : <img src={`/api/media/${m.id}/thumb`} alt={m.name} className="h-32 rounded-xl" />}
                    <button onClick={() => setMedia((c) => c.filter((x) => x.id !== m.id))} aria-label={`Remove ${m.name || 'media'}`} className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full bg-coral text-xs text-[#2c0610] shadow-[0_2px_0_var(--color-coral-deep)] transition-transform hover:scale-110"><FaXmark aria-hidden="true" /></button>
                  </div>
                ))}
              </div>
            )}
            {primary && (
              <p className="mt-2 text-xs text-ink-300">
                {primary.kind} · {primary.width}×{primary.height}{primary.duration != null ? ` · ${primary.duration.toFixed(1)}s` : ''} · {(primary.size / 1048576).toFixed(1)} MB
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <label htmlFor="content-type" className="font-extrabold text-ink-200">Content type</label>
              <select id="content-type" value={contentType} onChange={(e) => { setContentType(e.target.value); setTypeTouched(true) }} className="field !w-auto !py-1.5">
                <option value="text">Text</option><option value="image">Image(s)</option><option value="video">Video</option><option value="reel">Reel / Short</option>
              </select>
              {!typeTouched && media.length > 0 && <span className="pill pill-live">Auto-detected</span>}
            </div>
          </section>

          <section className="panel p-4 sm:p-5">
            <h2 className="panel-title mb-3"><span className="step-num">2</span>Write your message</h2>
            <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-ink-950 p-1" role="tablist" aria-label="Caption version">
              {['default', ...PLATFORMS].map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="tab-btn">
                  {t !== 'default' && <PlatformIcon platform={t} size="xs" />}
                  {t === 'default' ? 'Default' : PLATFORM_LABEL[t]}
                </button>
              ))}
            </div>

            {tab === 'default' ? (
              <div className="space-y-4">
                <div>
                  <label htmlFor="caption" className="label">Caption (used everywhere unless overridden)</label>
                  <textarea id="caption" value={caption} onChange={(e) => setCaption(e.target.value)} rows={6} placeholder="What are we launching today?" className="field resize-y" />
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {PLATFORMS.filter((p) => LIMITS[p]).map((p) => {
                      const over = capFor(p).length > LIMITS[p]
                      return (
                        <div key={p} style={{ '--pc': PLATFORM_META[p].color }}>
                          <div className={`mb-1 flex justify-between gap-2 text-[0.7rem] font-extrabold tabular-nums ${over ? 'text-coral' : 'text-ink-300'}`}>
                            <span>{PLATFORM_LABEL[p]}</span><span>{capFor(p).length}/{LIMITS[p]}</span>
                          </div>
                          <Bar pct={(capFor(p).length / LIMITS[p]) * 100} tone={over ? 'bad' : 'platform'} size="sm" label={`${PLATFORM_LABEL[p]} caption length`} />
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <label htmlFor="title" className="label">Title (YouTube, max 100)</label>
                  <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} className="field" />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label htmlFor="override" className="label">Caption override for {PLATFORM_LABEL[tab]} (empty = use default)</label>
                  <textarea id="override" value={overrides[tab].caption || ''} onChange={(e) => setOv(tab, 'caption', e.target.value)} rows={4} className="field resize-y" />
                </div>
                {tab === 'youtube' && (
                  <>
                    <input aria-label="Title override" placeholder="Title override" value={overrides.youtube.title || ''} onChange={(e) => setOv('youtube', 'title', e.target.value)} className="field" />
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <label htmlFor="privacy" className="font-extrabold text-ink-200">Privacy</label>
                      <select id="privacy" value={overrides.youtube.privacy} onChange={(e) => setOv('youtube', 'privacy', e.target.value)} className="field !w-auto !py-1.5">
                        <option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option>
                      </select>
                      {config.youtubeAudited === false && <span className="text-xs font-bold text-gold">Audit not passed: uploads will be private</span>}
                    </div>
                    <input aria-label="Tags" placeholder="Tags (comma separated)" value={overrides.youtube.tags || ''} onChange={(e) => setOv('youtube', 'tags', e.target.value)} className="field" />
                  </>
                )}
                {tab === 'instagram' && (
                  <label className="flex items-center gap-2 text-sm font-bold">
                    <input type="checkbox" className="h-4 w-4 accent-[#b6f427]" checked={overrides.instagram.shareToFeed !== false} onChange={(e) => setOv('instagram', 'shareToFeed', e.target.checked)} /> Also share Reel to feed
                  </label>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-5">
          <section className="panel p-4">
            <h2 className="panel-title mb-3"><span className="step-num">3</span>Choose your targets</h2>
            <ul className="space-y-2">
              {PLATFORMS.map((p) => {
                const r = results[p]
                const ok = selectable(p)
                const on = ok && !deselected.has(p)
                const why = r?.supported === false ? r.reason : !connected(p) ? 'Not connected' : null
                return (
                  <li key={p} title={why || ''}>
                    <label style={{ '--pc': PLATFORM_META[p].color }} className={`platform-toggle ${ok ? 'platform-toggle-ok' : 'platform-toggle-off'} ${on ? 'platform-toggle-on' : ''}`}>
                      <input type="checkbox" className="sr-only" disabled={!ok} checked={on} onChange={(e) => setDeselected((s) => { const n = new Set(s); e.target.checked ? n.delete(p) : n.add(p); return n })} />
                      <PlatformIcon platform={p} size="sm" />
                      <span className="min-w-0">
                        <span className="block font-extrabold leading-tight">{PLATFORM_LABEL[p]}</span>
                        {why && <span className="block text-xs leading-tight text-ink-300">{why}</span>}
                      </span>
                      <span className="check-box"><FaCheck aria-hidden="true" /></span>
                    </label>
                    {on && r?.errors.map((e, i) => <p key={i} className="ml-2 mt-1 text-xs font-bold text-coral">{e}</p>)}
                    {on && r?.warnings.map((e, i) => <p key={i} className="ml-2 mt-1 text-xs font-bold text-gold">{e}</p>)}
                  </li>
                )
              })}
            </ul>
          </section>

          <section className="panel p-4">
            <label htmlFor="schedule" className="label flex items-center gap-2"><FaCalendarDays className="text-grape" aria-hidden="true" />Schedule (optional)</label>
            <input id="schedule" type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} className="field" />
          </section>

          <section className="panel space-y-3.5 p-4">
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-sm font-extrabold">Launch readiness</span>
                <span className="font-display text-lg tabular-nums text-xp"><CountUp value={readiness} duration={400} />%</span>
              </div>
              <Bar pct={readiness} label="Launch readiness" />
              <ul className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-1 text-xs font-bold">
                {checks.map((c) => (
                  <li key={c.label} className={`flex items-center gap-1.5 ${c.done ? 'text-xp' : 'text-ink-300'}`}>
                    {c.done ? <FaCheck aria-hidden="true" /> : <span className="ml-0.5 inline-block h-2 w-2 rounded-full bg-ink-600" aria-hidden="true" />}{c.label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="xp-preview">
              <span className="flex items-center gap-2 text-sm font-extrabold">
                Reward{selected.length > 1 && <span key={selected.length} className="combo-tag">{selected.length}x combo</span>}
              </span>
              <span className="xp-tag !text-2xl"><FaBolt className="text-base" aria-hidden="true" />+<CountUp value={reward} duration={350} /> XP</span>
            </div>

            {error && <Notice>{error}</Notice>}
            <button
              onClick={publish}
              disabled={busy || !selected.length || blockers.length > 0 || uploading}
              className="btn btn-xp btn-launch"
            >
              <FaRocket aria-hidden="true" />
              {busy ? 'Submitting…' : schedule ? 'Schedule' : `Publish to ${selected.length} platform${selected.length === 1 ? '' : 's'}`}
            </button>
          </section>
        </aside>
      </div>

      {launching && <div className="launch-overlay" role="status" aria-label="Launching your post"><FaRocket className="launch-rocket" aria-hidden="true" /></div>}
    </div>
  )
}
