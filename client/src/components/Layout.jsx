import { useEffect, useState } from 'react'
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom'
import { FaClockRotateLeft, FaFire, FaPenNib, FaPlug, FaRocket, FaTrophy } from 'react-icons/fa6'
import { api, PLATFORM_LABEL } from '../api.js'
import { useGame } from '../game/useGame.js'
import { Bar, CountUp, Notice } from './ui.jsx'

const links = [
  ['/compose', 'Compose', FaPenNib],
  ['/quests', 'Quests', FaTrophy],
  ['/history', 'History', FaClockRotateLeft],
  ['/connections', 'Connections', FaPlug],
]

// Accounts that need attention: expired/errored tokens, or LinkedIn-style tokens expiring within 7 days.
function useTokenAlerts() {
  const [alerts, setAlerts] = useState([])
  useEffect(() => {
    const load = () => api.get('/api/connections').then((d) => {
      const out = []
      for (const c of d.connections) {
        if (c.status === 'disconnected') continue
        const name = PLATFORM_LABEL[c.platform]
        if (c.status === 'expired') out.push({ level: 'error', text: `${name} token expired or revoked` })
        else if (c.status === 'error') out.push({ level: 'warn', text: `${name} token check failed` })
        else if (c.daysLeft != null && c.daysLeft < 7) out.push({ level: 'warn', text: `${name} token expires in ${Math.max(c.daysLeft, 0)} day(s)` })
      }
      setAlerts(out)
    }).catch(() => {})
    load()
    const t = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])
  return alerts
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
  const { pathname } = useLocation()
  const hasError = alerts.some((a) => a.level === 'error')
  return (
    <div className="min-h-screen pb-24 md:pb-10">
      <header className="sticky top-0 z-40 border-b-2 border-ink-800 bg-ink-950/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5" aria-label="Main">
          <Link to="/compose" className="flex items-center gap-2.5" aria-label="Social Automations home">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-xp text-lg text-[#17220a] shadow-[0_3px_0_var(--color-xp-deep)]"><FaRocket aria-hidden="true" /></span>
            <span className="hidden font-display text-lg leading-none lg:block">Social<br /><span className="text-xp">Automations</span></span>
          </Link>
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
              <Link to="/connections" className="font-black underline">Reconnect</Link>
            </span>
          </Notice>
        </div>
      )}

      <main key={pathname} className="page-in mx-auto max-w-6xl px-4 py-7">
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
