import { useState } from 'react'
import { api } from '../api.js'
import { Notice } from '../components/ui.jsx'

export const COLORS = ['#5b5bf0', '#0ea5e9', '#14b8a6', '#22c55e', '#f59e0b', '#f43f5e', '#a855f7', '#64748b']

/** Create (no `project`) or edit (with `project`) form. */
export function ProjectForm({ project, onDone, onCancel, submitLabel = 'Save' }) {
  const [name, setName] = useState(project?.name || '')
  const [color, setColor] = useState(project?.color || COLORS[0])
  const [icon, setIcon] = useState(project?.icon || '')
  const [description, setDescription] = useState(project?.description || '')
  const [footer, setFooter] = useState(project?.settings?.captionFooter || '')
  const [hashtags, setHashtags] = useState(project?.settings?.hashtags || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const body = { name, color, icon: icon || null, description: description || null, settings: { captionFooter: footer, hashtags } }
    try {
      const d = project ? await api.patch(`/api/projects/${project.id}`, body) : await api.post('/api/projects', body)
      await onDone(d.project)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm font-semibold text-ink">Name
        <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus placeholder="e.g. Xavia Solutions" />
      </label>
      <div className="flex flex-wrap items-end gap-4">
        <fieldset>
          <legend className="text-sm font-semibold text-ink">Color</legend>
          <div className="mt-2 flex flex-wrap gap-3 px-1 pb-1">
            {COLORS.map((c) => (
              <button type="button" key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`} aria-pressed={color === c}
                className="h-7 w-7 rounded-full ring-offset-2 transition-shadow" style={{ background: c, boxShadow: color === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : 'none' }} />
            ))}
          </div>
        </fieldset>
        <label className="block w-36 text-sm font-semibold text-ink">Icon
          <input className="field mt-1" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={8} placeholder="Emoji (optional)" />
        </label>
      </div>
      <label className="block text-sm font-semibold text-ink">Description
        <input className="field mt-1" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="Optional" />
      </label>
      <label className="block text-sm font-semibold text-ink">Caption footer
        <textarea className="field mt-1" rows={2} value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={500} placeholder="Added to the end of every caption, e.g. Follow us for more" />
      </label>
      <label className="block text-sm font-semibold text-ink">Default hashtags
        <input className="field mt-1" value={hashtags} onChange={(e) => setHashtags(e.target.value)} maxLength={300} placeholder="#brand #topic" />
      </label>
      {error && <Notice>{error}</Notice>}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" onClick={onCancel} className="btn">Cancel</button>}
      </div>
    </form>
  )
}
