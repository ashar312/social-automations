import { useEffect, useRef, useState } from 'react'
import { NavLink, Link, Outlet, useNavigate } from 'react-router-dom'
import { FaChevronDown, FaClockRotateLeft, FaFire, FaFolder, FaPenNib, FaPlug, FaTrophy } from 'react-icons/fa6'
import { api, PLATFORM_LABEL } from '../api.js'
import { useGame } from '../game/useGame.js'
import { useProject } from '../projects/useProject.js'
import { Bar, CountUp, Notice } from './ui.jsx'

const links = [
  ['/compose', 'Compose', FaPenNib],
  ['/quests', 'Quests', FaTrophy],
  ['/history', 'History', FaClockRotateLeft],
  ['/connections', 'Connections', FaPlug],
  ['/projects', 'Projects', FaFolder],
]

// Accounts that need attention in ANY active project: expired/errored tokens, or tokens expiring within 7 days.
function useTokenAlerts() {
  const [alerts, setAlerts] = useState([])
  useEffect(() => {
    const load = () => api.get('/api/connections/alerts').then((d) => {
      setAlerts(d.alerts.map((a) => {
        const what = a.status === 'expired' ? 'token expired or revoked' : a.status === 'error' ? 'token check failed' : `token expires in ${Math.max(a.daysLeft, 0)} day(s)`
        return { level: a.level, projectId: a.projectId, text: `${a.projectName} · ${PLATFORM_LABEL[a.platform]} ${what}` }
      }))
    }).catch(() => {})
    load()
    const t = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])
  return alerts
}

function ProjectSwitcher() {
  const { projects, active, setActive } = useProject()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])
  const go = (fn) => { setOpen(false); fn() }
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={`Active project: ${active.name}`}
        className="btn btn-ghost btn-sm max-w-44" style={{ borderColor: active.color }}>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: active.color }} aria-hidden="true" />
        <span className="truncate">{active.icon} {active.name}</span>
        <FaChevronDown className="shrink-0 text-xs" aria-hidden="true" />
      </button>
      {open && (
        <ul role="listbox" aria-label="Projects" className="panel absolute left-0 top-full z-50 mt-2 w-64 space-y-1 p-2">
          {projects.filter((p) => !p.archived).map((p) => (
            <li key={p.id} role="option" aria-selected={p.id === active.id}>
              <button onClick={() => go(() => setActive(p.id))} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-extrabold hover:bg-ink-800">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden="true" />
                <span className="truncate">{p.icon} {p.name}</span>
                {p.id === active.id && <span className="ml-auto text-xp">✓</span>}
              </button>
            </li>
          ))}
          <li className="border-t-2 border-ink-800 pt-1">
            <button onClick={() => go(() => nav('/projects'))} className="w-full rounded-lg px-2.5 py-2 text-left text-sm font-extrabold hover:bg-ink-800">＋ New / manage projects</button>
          </li>
        </ul>
      )}
    </div>
  )
}

function PlayerHud() {
  const { stats } = useGame()
  if (!stats) return <div className="skeleton h-11 w-44" aria-hidden="true" />
  const streakLabel = `${stats.streak} day streak${stats.streak && !stats.postedToday ? ', post today to keep it' : ''}`
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className={`streak ${stats.streak ? 'streak-on' : ''}`} title={streakLabel} aria-label={streakLabel}>
        <FaFire aria-hidden="true" />{stats.streak}
      </span>
      <Link to="/quests" className="flex min-w-0 items-center gap-2 rounded-xl" aria-label={`Level ${stats.level}, ${stats.title}, ${stats.xp} XP`}>
        <span className="level-gem">{stats.level}</span>
        <span className="hidden w-36 sm:block">
          <span className="flex items-baseline justify-between gap-2 text-[0.7rem] font-extrabold">
            <span className="truncate text-ink-100">{stats.title}</span>
            <span className="shrink-0 tabular-nums text-xp"><CountUp value={stats.into} />/{stats.needed}</span>
          </span>
          <span className="mt-1 block"><Bar pct={stats.pct} size="sm" label="Progress to next level" /></span>
        </span>
      </Link>
    </div>
  )
}

export default function Layout() {
  const alerts = useTokenAlerts()
  const { active, setActive } = useProject()
  const nav = useNavigate()
  const hasError = alerts.some((a) => a.level === 'error')
  return (
    <div className="min-h-screen pb-24 md:pb-10">
      <header className="sticky top-0 z-40 border-b-2 border-ink-800 bg-ink-950/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5" aria-label="Main">
          <Link to="/compose" className="flex items-center gap-2.5" aria-label="Social Automations home">
            <img src="/logo.svg" alt="" className="h-10 w-10" />
            <span className="hidden font-display text-lg leading-none lg:block">Social<br /><span className="text-xp">Automations</span></span>
          </Link>
          <ProjectSwitcher />
          <div className="hidden items-center gap-1 md:flex">
            {links.map(([to, label, Icon]) => (
              <NavLink key={to} to={to} className="nav-link"><Icon aria-hidden="true" />{label}</NavLink>
            ))}
          </div>
          <PlayerHud />
        </nav>
      </header>

      {alerts.length > 0 && (
        <div className="mx-auto mt-4 max-w-6xl px-4">
          <Notice tone={hasError ? 'bad' : 'warn'}>
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>{alerts.map((a) => a.text).join(' · ')}</span>
              <button onClick={() => { setActive(alerts[0].projectId); nav('/connections') }} className="font-black underline">Reconnect</button>
            </span>
          </Notice>
        </div>
      )}

      <main key={active.id} className="page-in mx-auto max-w-6xl px-4 py-7">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t-2 border-ink-800 bg-ink-950/95 px-2 py-1 backdrop-blur-md md:hidden" aria-label="Main mobile">
        {links.map(([to, label, Icon]) => (
          <NavLink key={to} to={to} className="tab-link"><Icon aria-hidden="true" />{label}</NavLink>
        ))}
      </nav>
    </div>
  )
}
