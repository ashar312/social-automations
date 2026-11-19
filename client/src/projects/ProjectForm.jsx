import { useState } from 'react'
import { api } from '../api.js'
import { Notice } from '../components/ui.jsx'

export const COLORS = ['#7c5cff', '#b6f427', '#22d3ee', '#ff6b6b', '#ffb020', '#ec4899', '#10b981', '#3b82f6']

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
      <label className="block text-sm font-extrabold">Name
        <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus placeholder="e.g. Xavia Solutions" />
      </label>
      <div className="flex flex-wrap items-end gap-4">
        <fieldset>
          <legend className="text-sm font-extrabold">Color</legend>
          <div className="mt-1 flex gap-2">
            {COLORS.map((c) => (
              <button type="button" key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`} aria-pressed={color === c}
                className="h-8 w-8 rounded-full border-2" style={{ background: c, borderColor: color === c ? '#fff' : 'transparent' }} />
            ))}
          </div>
        </fieldset>
        <label className="block w-24 text-sm font-extrabold">Icon
          <input className="field mt-1" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={8} placeholder="🚀" />
        </label>
      </div>
      <label className="block text-sm font-extrabold">Description
        <input className="field mt-1" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="Optional" />
      </label>
      <label className="block text-sm font-extrabold">Caption footer
        <textarea className="field mt-1" rows={2} value={footer} onChange={(e) => setFooter(e.target.value)} maxLength={500} placeholder="Added to the end of every caption, e.g. Follow us for more" />
      </label>
      <label className="block text-sm font-extrabold">Default hashtags
        <input className="field mt-1" value={hashtags} onChange={(e) => setHashtags(e.target.value)} maxLength={300} placeholder="#brand #topic" />
      </label>
      {error && <Notice>{error}</Notice>}
      <div className="flex gap-2">
        <button className="btn btn-xp btn-sm" disabled={busy || !name.trim()}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm">Cancel</button>}
      </div>
    </form>
  )
}
