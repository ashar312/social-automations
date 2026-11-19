import { useState } from 'react'
import { FaCopy, FaKey, FaRotate, FaTrash } from 'react-icons/fa6'
import { api } from '../api.js'
import { Notice } from '../components/ui.jsx'
import { useConfirm } from '../components/useConfirm.js'

const when = (d) => (d ? new Date(d).toLocaleString() : 'never')

export function Copy({ text, label }) {
  const [done, setDone] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* select it by hand */ }
  }
  return <button type="button" onClick={copy} className="btn btn-sm" aria-label={`Copy ${label}`}><FaCopy aria-hidden="true" />{done ? 'Copied' : 'Copy'}</button>
}

/** Project id + API key for the external API (/api/v1). See plans/guides/api.md */
export function ApiAccess({ project, onChange, onKey }) {
  const confirm = useConfirm()
  const [key, setKey] = useState('') // plain key, shown once
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function generate() {
    if (project.apiKey) {
      const sure = await confirm({ title: 'Replace the API key?', body: 'The current key stops working right away. Every system using it must get the new one.', confirmLabel: 'Replace key', danger: true })
      if (!sure) return
    }
    setBusy(true); setError('')
    try { const d = await api.post(`/api/projects/${project.id}/api-key`); setKey(d.key); onKey?.(d.key); await onChange() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function revoke() {
    const sure = await confirm({ title: 'Revoke the API key?', body: 'Systems using it get 401 errors from now on.', confirmLabel: 'Revoke', danger: true })
    if (!sure) return
    setBusy(true); setError('')
    try { await api.del(`/api/projects/${project.id}/api-key`); setKey(''); onKey?.(''); await onChange() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="mt-4 rounded-xl border border-line p-3 text-sm">
      <p className="mb-2 font-semibold text-ink">API access</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Project ID</span>
        <code className="rounded bg-black/5 px-1.5 py-0.5 text-xs">{project.publicId}</code>
        <Copy text={project.publicId} label="project ID" />
      </div>
      {key ? (
        <div className="mt-3">
          <Notice tone="warn">Copy this key now. It is not shown again.</Notice>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-black/5 px-1.5 py-0.5 text-xs">{key}</code>
            <Copy text={key} label="API key" />
          </div>
        </div>
      ) : project.apiKey ? (
        <p className="mt-2 text-muted">Key <code className="text-xs">sa_live_…{project.apiKey.hint}</code> · created {when(project.apiKey.createdAt)} · last used {when(project.apiKey.lastUsedAt)}</p>
      ) : (
        <p className="mt-2 text-muted">No API key yet. Other systems need one to post to this project.</p>
      )}
      {error && <div className="mt-2"><Notice>{error}</Notice></div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={generate} className="btn btn-sm">
          {project.apiKey ? <><FaRotate aria-hidden="true" />New key</> : <><FaKey aria-hidden="true" />Generate API key</>}
        </button>
        {project.apiKey && <button type="button" disabled={busy} onClick={revoke} className="btn btn-danger btn-sm"><FaTrash aria-hidden="true" />Revoke</button>}
      </div>
    </div>
  )
}
