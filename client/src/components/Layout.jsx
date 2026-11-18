import { useEffect, useState } from 'react'
import { NavLink, Link, Outlet } from 'react-router-dom'
import { api, PLATFORM_LABEL } from '../api.js'

const links = [
  ['/compose', 'Compose'],
  ['/history', 'History'],
  ['/connections', 'Connections'],
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

export default function Layout() {
  const alerts = useTokenAlerts()
  const hasError = alerts.some((a) => a.level === 'error')
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <span className="font-semibold">Social Automations</span>
          {links.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                isActive ? 'font-medium text-indigo-600' : 'text-slate-600 hover:text-slate-900'
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      {alerts.length > 0 && (
        <div className={`border-b px-4 py-2 text-sm ${hasError ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
            <span>{alerts.map((a) => a.text).join(' · ')}</span>
            <Link to="/connections" className="font-medium underline">Reconnect</Link>
          </div>
        </div>
      )}
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
