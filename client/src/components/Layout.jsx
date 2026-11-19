import { useEffect, useRef, useState } from 'react'
import { NavLink, Link, Outlet, useNavigate } from 'react-router-dom'
import { FaCheck, FaChevronDown, FaClockRotateLeft, FaFolder, FaPenNib, FaPlug, FaPlus, FaTableCellsLarge } from 'react-icons/fa6'
import { api, PLATFORM_LABEL } from '../api.js'
import { useProject } from '../projects/useProject.js'
import { Notice } from './ui.jsx'

const links = [
  ['/overview', 'Overview', FaTableCellsLarge],
  ['/compose', 'Compose', FaPenNib],
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
    <div ref={ref} className="relative min-w-0">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} aria-label={`Active project: ${active.name}`}
        className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-left shadow-card transition-colors hover:border-line-strong">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-sm text-white" style={{ background: active.color }} aria-hidden="true">{active.icon || active.name.charAt(0).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.68rem] font-medium leading-none text-muted">Project</span>
          <span className="mt-0.5 block truncate text-sm font-semibold leading-tight text-ink">{active.name}</span>
        </span>
        <FaChevronDown className="shrink-0 text-[0.65rem] text-muted" aria-hidden="true" />
      </button>
      {open && (
        <ul role="listbox" aria-label="Projects" className="card absolute left-0 right-0 top-full z-50 mt-2 min-w-56 space-y-0.5 p-1.5 shadow-lift">
          {projects.filter((p) => !p.archived).map((p) => (
            <li key={p.id} role="option" aria-selected={p.id === active.id}>
              <button onClick={() => go(() => setActive(p.id))} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-ink hover:bg-sunken">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden="true" />
                <span className="truncate">{p.name}</span>
                {p.id === active.id && <FaCheck className="ml-auto shrink-0 text-xs text-brand" aria-hidden="true" />}
              </button>
            </li>
          ))}
          <li className="mt-1 border-t border-line pt-1">
            <button onClick={() => go(() => nav('/projects'))} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-muted hover:bg-sunken hover:text-ink">
              <FaPlus className="text-xs" aria-hidden="true" />New / manage projects
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}

function Brand() {
  return (
    <Link to="/overview" className="flex items-center gap-2.5" aria-label="Social Automations home">
      <img src="/logo.svg" alt="" className="h-8 w-8" />
      <span className="text-[0.95rem] font-semibold tracking-tight text-ink">Social Automations</span>
    </Link>
  )
}

export default function Layout() {
  const alerts = useTokenAlerts()
  const { active, setActive } = useProject()
  const nav = useNavigate()
  const hasError = alerts.some((a) => a.level === 'error')
  return (
    <div className="min-h-screen pb-20 lg:pb-0 lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col gap-6 border-r border-line bg-surface/80 px-4 py-5 backdrop-blur-md lg:flex">
        <Brand />
        <ProjectSwitcher />
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {links.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} className="nav-item"><Icon aria-hidden="true" />{label}</NavLink>
          ))}
        </nav>
      </aside>

      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-line bg-surface/85 px-4 py-2.5 backdrop-blur-md lg:hidden">
        <Brand />
        <div className="w-44"><ProjectSwitcher /></div>
      </header>

      {alerts.length > 0 && (
        <div className="mx-auto mt-5 max-w-5xl px-4 sm:px-8">
          <Notice tone={hasError ? 'bad' : 'warn'}>
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>{alerts.map((a) => a.text).join(' · ')}</span>
              <button onClick={() => { setActive(alerts[0].projectId); nav('/connections') }} className="font-semibold underline">Reconnect</button>
            </span>
          </Notice>
        </div>
      )}

      <main key={active.id} className="page-in mx-auto max-w-5xl px-4 py-8 sm:px-8 lg:py-10">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-line bg-surface/95 px-2 py-1 backdrop-blur-md lg:hidden" aria-label="Main mobile">
        {links.map(([to, label, Icon]) => (
          <NavLink key={to} to={to} className="tab-link"><Icon aria-hidden="true" />{label}</NavLink>
        ))}
      </nav>
    </div>
  )
}
