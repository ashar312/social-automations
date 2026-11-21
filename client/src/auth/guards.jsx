import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth, safeNext } from './useAuth.js'

const Splash = () => <div className="mx-auto max-w-xl p-8"><div className="skeleton h-40" aria-label="Loading" /></div>

export function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  const { pathname, search } = useLocation()
  if (loading) return <Splash />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />
  return children
}

/** Login / signup pages: signed-in users go straight to the app. */
export function GuestOnly() {
  const { user, loading } = useAuth()
  const [q] = useSearchParams()
  if (loading) return <Splash />
  if (user) return <Navigate to={safeNext(q.get('next'))} replace />
  return <Outlet />
}
