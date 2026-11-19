import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { FaFolderPlus } from 'react-icons/fa6'
import { api } from '../api.js'
import { Notice } from '../components/ui.jsx'
import { ProjectContext } from './useProject.js'
import { ProjectForm } from './ProjectForm.jsx'

const KEY = 'sa.activeProject'
const readId = () => { try { return Number(localStorage.getItem(KEY)) || null } catch { return null } }
const writeId = (id) => { try { localStorage.setItem(KEY, String(id)) } catch { /* the choice just will not survive a reload */ } }

export function ProjectProvider({ children }) {
  const nav = useNavigate()
  const { pathname, search } = useLocation()
  const [projects, setProjects] = useState(null)
  const [activeId, setActiveId] = useState(readId)
  const [loadError, setLoadError] = useState('')

  const reload = useCallback(() => api.get('/api/projects').then((d) => {
    setProjects(d.projects); setLoadError('')
    return d.projects
  }).catch((e) => setLoadError(e.message)), [])
  useEffect(() => { reload() }, [reload])

  const setActive = useCallback((id) => { writeId(id); setActiveId(id) }, [])

  // OAuth returns with ?project=<id>: switch to it and strip the param
  useEffect(() => {
    const q = new URLSearchParams(search)
    const p = Number(q.get('project'))
    if (!p) return
    setActive(p)
    q.delete('project')
    nav({ pathname, search: q.toString() ? `?${q}` : '' }, { replace: true })
  }, [search, pathname, nav, setActive])

  const active = useMemo(() => {
    if (!projects || !projects.length) return null
    return projects.find((p) => p.id === activeId && !p.archived) || projects.find((p) => !p.archived) || projects[0]
  }, [projects, activeId])

  const projectApi = useCallback((path = '') => `/api/projects/${active?.id}${path}`, [active])
  const value = useMemo(() => ({ projects, active, setActive, reload, projectApi }), [projects, active, setActive, reload, projectApi])

  if (loadError) return <div className="mx-auto max-w-xl p-8"><Notice>Could not load projects: {loadError}</Notice></div>
  if (!projects) return <div className="mx-auto max-w-xl p-8"><div className="skeleton h-40" aria-label="Loading" /></div>
  if (!projects.length) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="card p-6">
          <span className="stat-icon mb-4 !h-11 !w-11 !text-lg"><FaFolderPlus aria-hidden="true" /></span>
          <h1 className="text-2xl font-semibold">Create your first project</h1>
          <p className="mb-5 mt-1 text-sm text-muted">A project is one channel or brand, with its own LinkedIn, YouTube, Facebook and Instagram connections.</p>
          <ProjectForm submitLabel="Create project" onDone={async (p) => { setActive(p.id); await reload() }} />
        </div>
      </div>
    )
  }
  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}
