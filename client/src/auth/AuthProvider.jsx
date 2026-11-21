import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { AuthContext } from './useAuth.js'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => api.get('/api/auth/me').then((d) => { setUser(d.user); return d.user }).catch(() => { setUser(null); return null }), [])
  useEffect(() => { refresh().finally(() => setLoading(false)) }, [refresh])
  useEffect(() => {
    const expired = () => setUser(null)
    window.addEventListener('auth:expired', expired)
    return () => window.removeEventListener('auth:expired', expired)
  }, [])

  const login = useCallback(async (email, password) => { const d = await api.post('/api/auth/login', { email, password }); setUser(d.user); return d.user }, [])
  const signup = useCallback(async (name, email, password) => { const d = await api.post('/api/auth/signup', { name, email, password }); setUser(d.user); return d.user }, [])
  const logout = useCallback(async () => { await api.post('/api/auth/logout').catch(() => {}); setUser(null) }, [])
  const value = useMemo(() => ({ user, setUser, loading, login, signup, logout, refresh }), [user, loading, login, signup, logout, refresh])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
