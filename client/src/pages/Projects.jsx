import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FaBoxArchive, FaPen, FaPlus, FaRotateLeft, FaTrash } from 'react-icons/fa6'
import { api } from '../api.js'
import { Notice, PageTitle, PlatformIcon } from '../components/ui.jsx'
import { useConfirm } from '../components/useConfirm.js'
import { ProjectForm } from '../projects/ProjectForm.jsx'
import { useProject } from '../projects/useProject.js'

export default function Projects() {
  const nav = useNavigate()
  const confirm = useConfirm()
  const { projects, active, setActive, reload } = useProject()
  const [editing, setEditing] = useState(null) // project object | 'new' | null
  const [error, setError] = useState('')
  const activeCount = projects.filter((x) => !x.archived).length

  async function archive(p, archived) {
    setError('')
    if (archived) {
      const sure = await confirm({ title: `Archive ${p.name}?`, body: 'It is hidden from the switcher. Posts already queued still publish, and history is kept.', confirmLabel: 'Archive' })
      if (!sure) return
    }
    try { await api.patch(`/api/projects/${p.id}`, { archived }); await reload() } catch (e) { setError(e.message) }
  }
  async function remove(p) {
    setError('')
    const sure = await confirm({ title: `Delete ${p.name}?`, body: 'Its connections are removed. This cannot be undone.', confirmLabel: 'Delete', danger: true })
    if (!sure) return
    try { await api.del(`/api/projects/${p.id}`); await reload() } catch (e) { setError(e.message) }
  }
  const open = (p) => { setActive(p.id); nav('/connections') }

  return (
    <div>
      <PageTitle eyebrow="Workspace" title="Projects">
        <button onClick={() => setEditing('new')} className="btn btn-primary"><FaPlus aria-hidden="true" />New project</button>
      </PageTitle>
      {error && <div className="mb-4"><Notice>{error}</Notice></div>}
      {editing === 'new' && (
        <div className="card mb-5 p-5">
          <p className="card-title mb-3">New project</p>
          <ProjectForm submitLabel="Create project" onCancel={() => setEditing(null)} onDone={async (p) => { setEditing(null); setActive(p.id); await reload() }} />
        </div>
      )}
      <div className="stagger grid gap-5 sm:grid-cols-2">
        {projects.map((p, i) => (
          <div key={p.id} style={{ '--i': i }} className={`card p-5 ${p.archived ? 'opacity-60' : ''}`}>
            {editing?.id === p.id ? (
              <ProjectForm project={p} submitLabel="Save" onCancel={() => setEditing(null)} onDone={async () => { setEditing(null); await reload() }} />
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-lg font-semibold leading-tight text-ink">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden="true" />
                      <span className="truncate">{p.icon} {p.name}</span>
                    </div>
                    {p.description && <p className="mt-1 text-sm text-muted">{p.description}</p>}
                  </div>
                  {active.id === p.id && <span className="pill pill-good">Active</span>}
                  {p.archived && <span className="pill pill-mute">Archived</span>}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {p.connected.length ? p.connected.map((pl) => <PlatformIcon key={pl} platform={pl} size="xs" />) : <span className="text-xs text-muted">No connections yet</span>}
                  <span className="ml-auto text-xs font-medium text-muted">{p.postCount} post{p.postCount === 1 ? '' : 's'}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!p.archived && <button onClick={() => open(p)} className="btn btn-sm">Open</button>}
                  <button onClick={() => setEditing(p)} className="btn btn-sm"><FaPen aria-hidden="true" />Edit</button>
                  {p.archived
                    ? <button onClick={() => archive(p, false)} className="btn btn-sm"><FaRotateLeft aria-hidden="true" />Restore</button>
                    : activeCount > 1 && <button onClick={() => archive(p, true)} className="btn btn-sm"><FaBoxArchive aria-hidden="true" />Archive</button>}
                  {p.postCount === 0 && projects.length > 1 && <button onClick={() => remove(p)} className="btn btn-danger btn-sm"><FaTrash aria-hidden="true" />Delete</button>}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
