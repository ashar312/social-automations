import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { FaArrowUp, FaBolt, FaTrophy } from 'react-icons/fa6'
import { api } from '../api.js'
import { Modal } from '../components/ui.jsx'
import { burstConfetti } from './confetti.js'
import { buildStats } from './engine.js'
import { GameContext } from './useGame.js'

const STORE_KEY = 'social-automations.game.v1'

function readSeen() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) } catch { return null }
}
function writeSeen(value) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(value)) } catch { /* progress still works for this session */ }
}

async function fetchAllPosts() {
  const posts = []
  for (let page = 1; ; page += 1) {
    const d = await api.get(`/api/posts?page=${page}&limit=50`)
    posts.push(...d.posts)
    if (!d.posts.length || posts.length >= d.total) return posts
  }
}

const isInFlight = (p) => p.status === 'publishing' || (p.status === 'queued' && (!p.scheduledAt || new Date(p.scheduledAt) <= new Date()))

function LevelUp({ level, title, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="levelup-overlay" role="dialog" aria-modal="true" aria-label="Level up">
      <div className="game-modal game-modal-body text-center">
        <div className="levelup-badge mx-auto"><span>{level}</span></div>
        <p className="mt-5 flex items-center justify-center gap-2 text-sm font-extrabold uppercase tracking-[0.2em] text-xp"><FaArrowUp aria-hidden="true" />Level up</p>
        <h2 className="mt-1 font-display text-4xl">{title}</h2>
        <p className="mt-2 text-ink-200">You reached level {level}. Keep the streak alive.</p>
        <button autoFocus onClick={onClose} className="btn btn-xp mt-6 w-full">Keep going</button>
      </div>
    </div>
  )
}

export function GameProvider({ children }) {
  const { pathname } = useLocation()
  const [stats, setStats] = useState(null)
  const [toasts, setToasts] = useState([])
  const [levelUp, setLevelUp] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [polling, setPolling] = useState(false)
  const seen = useRef(readSeen())
  const requestId = useRef(0)
  const toastId = useRef(0)

  const toast = useCallback((item) => {
    const id = ++toastId.current
    setToasts((list) => [...list, { ...item, id }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 5000)
  }, [])

  const refresh = useCallback(async () => {
    const id = ++requestId.current
    try {
      const [posts, conns] = await Promise.all([fetchAllPosts(), api.get('/api/connections')])
      if (id !== requestId.current) return
      const next = buildStats(posts, conns.connections)
      const unlocked = next.achievements.filter((a) => a.unlocked).map((a) => a.id)
      const before = seen.current
      // The first visit only records a baseline, so existing progress never fires a wave of rewards.
      if (before) {
        const gained = next.xp - before.xp
        const fresh = next.achievements.filter((a) => a.unlocked && !before.unlocked.includes(a.id))
        if (gained > 0) toast({ kind: 'xp', title: `+${gained} XP`, body: 'Nice launch. Progress saved.' })
        fresh.forEach((a) => toast({ kind: 'trophy', title: a.name, body: `Trophy unlocked: ${a.desc}` }))
        if (next.level > before.level) {
          setLevelUp({ level: next.level, title: next.title })
          burstConfetti({ count: 190 })
        } else if (gained > 0 || fresh.length) {
          burstConfetti()
        }
      }
      seen.current = { xp: next.xp, level: next.level, unlocked }
      writeSeen(seen.current)
      setStats(next)
      setPolling(posts.some(isInFlight))
    } catch { /* the HUD keeps its last known state while the API is unreachable */ }
  }, [toast])

  useEffect(() => { refresh() }, [refresh, pathname])
  useEffect(() => {
    if (!polling) return undefined
    const t = setInterval(refresh, 8000)
    return () => clearInterval(t)
  }, [polling, refresh])

  const confirm = useCallback((options) => new Promise((resolve) => setDialog({ ...options, resolve })), [])
  const closeDialog = (answer) => { dialog?.resolve(answer); setDialog(null) }
  const closeLevelUp = useCallback(() => setLevelUp(null), [])

  const value = useMemo(() => ({ stats, refresh, confirm }), [stats, refresh, confirm])

  return (
    <GameContext.Provider value={value}>
      {children}

      <div className="pointer-events-none fixed right-4 top-20 z-[80] flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'trophy' ? 'toast-trophy' : ''}`}>
            <span className="toast-icon">{t.kind === 'trophy' ? <FaTrophy aria-hidden="true" /> : <FaBolt aria-hidden="true" />}</span>
            <div className="min-w-0">
              <p className="font-display text-lg leading-tight">{t.title}</p>
              <p className="text-xs text-ink-200">{t.body}</p>
            </div>
          </div>
        ))}
      </div>

      {levelUp && <LevelUp level={levelUp.level} title={levelUp.title} onClose={closeLevelUp} />}

      {dialog && (
        <Modal onClose={() => closeDialog(false)} label={dialog.title}>
          <h2 className="font-display text-2xl">{dialog.title}</h2>
          {dialog.body && <p className="mt-2 text-sm text-ink-200">{dialog.body}</p>}
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button autoFocus onClick={() => closeDialog(false)} className="btn btn-ghost">{dialog.cancelLabel || 'Cancel'}</button>
            <button onClick={() => closeDialog(true)} className={`btn ${dialog.danger ? 'btn-danger' : 'btn-xp'}`}>{dialog.confirmLabel || 'Confirm'}</button>
          </div>
        </Modal>
      )}
    </GameContext.Provider>
  )
}
