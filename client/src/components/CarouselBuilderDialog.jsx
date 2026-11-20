import { useState } from 'react'
import { FaArrowDown, FaArrowUp, FaGripVertical } from 'react-icons/fa6'
import { buildCarousel } from '../api.js'
import { Modal, Notice } from './ui.jsx'

const SIZES = [
  { id: '1080x1080', label: '1:1', hint: 'Square', w: 1, h: 1 },
  { id: '1080x1350', label: '4:5', hint: 'Portrait, best on LinkedIn', w: 4, h: 5 },
  { id: '1920x1080', label: '16:9', hint: 'Landscape', w: 16, h: 9 },
]

/**
 * "Make a carousel from these images": pick page size, fit, background and slide order,
 * then the server builds one PDF (plans/07 section 3). onDone(pdfMedia) replaces the images.
 */
export default function CarouselBuilderDialog({ images, base, defaultName, onClose, onDone }) {
  const [order, setOrder] = useState(images)
  const [size, setSize] = useState('1080x1350')
  const [fit, setFit] = useState('contain')
  const [background, setBackground] = useState('#ffffff')
  const [dragIdx, setDragIdx] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const s = SIZES.find((x) => x.id === size)

  const move = (from, to) => setOrder((cur) => {
    if (to < 0 || to >= cur.length || from === to) return cur
    const next = cur.slice()
    const [it] = next.splice(from, 1)
    next.splice(to, 0, it)
    return next
  })

  async function create() {
    setBusy(true); setError('')
    try {
      const name = `${(defaultName || 'carousel').replace(/\.pdf$/i, '').slice(0, 120)}.pdf`
      const r = await buildCarousel(base, { mediaIds: order.map((m) => m.id), size, fit, background, name })
      onDone(r)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <Modal label="Make a PDF carousel" onClose={busy ? () => {} : onClose} wide>
      <h2 className="text-lg font-semibold">Make a LinkedIn carousel</h2>
      <p className="mt-1 text-sm text-muted">Each image becomes one swipeable page of a PDF.</p>

      <fieldset className="mt-5">
        <legend className="label">Page size</legend>
        <div className="grid grid-cols-3 gap-2">
          {SIZES.map((x) => (
            <label key={x.id} className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-sm transition ${size === x.id ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong'}`}>
              <input type="radio" name="carousel-size" value={x.id} checked={size === x.id} onChange={() => setSize(x.id)} className="sr-only" />
              <span className="flex h-10 items-center" aria-hidden="true">
                <span className="block rounded-sm border-2 border-current text-brand" style={{ width: (x.w / Math.max(x.w, x.h)) * 36, height: (x.h / Math.max(x.w, x.h)) * 36 }} />
              </span>
              <span className="font-semibold">{x.label}</span>
              <span className="text-[0.7rem] leading-tight text-muted">{x.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-end gap-5">
        <fieldset>
          <legend className="label">Fit</legend>
          <div className="flex gap-1 rounded-xl bg-sunken p-1" role="radiogroup">
            {[['contain', 'Whole image'], ['cover', 'Fill page (crop)']].map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={fit === id} aria-selected={fit === id} onClick={() => setFit(id)} className="tab-btn">{label}</button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="carousel-bg" className="label">Background</label>
          <input id="carousel-bg" type="color" value={background} onChange={(e) => setBackground(e.target.value)} disabled={fit === 'cover'}
            className="h-9 w-14 cursor-pointer rounded-md border border-line bg-surface p-0.5 disabled:opacity-40" />
        </div>
      </div>

      <div className="mt-5">
        <p className="label">Slides <span className="font-normal text-muted">(drag to reorder)</span></p>
        <ol className="flex max-h-72 flex-wrap gap-3 overflow-y-auto p-0.5">
          {order.map((m, i) => (
            <li
              key={m.id}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (dragIdx != null) move(dragIdx, i); setDragIdx(null) }}
              onDragEnd={() => setDragIdx(null)}
              className={`w-24 cursor-grab rounded-lg border bg-surface p-1 ${dragIdx === i ? 'border-brand opacity-60' : 'border-line'}`}
            >
              <div className="overflow-hidden rounded" style={{ aspectRatio: `${s.w} / ${s.h}`, background }}>
                <img src={`/api/media/${m.id}/thumb`} alt={m.name} draggable={false} className={`h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`} />
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted">
                <FaGripVertical aria-hidden="true" />
                <span className="font-semibold tabular-nums">{i + 1}</span>
                <span className="flex">
                  <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move slide ${i + 1} earlier`} className="rounded p-0.5 hover:text-ink disabled:opacity-30"><FaArrowUp className="-rotate-90" aria-hidden="true" /></button>
                  <button type="button" onClick={() => move(i, i + 1)} disabled={i === order.length - 1} aria-label={`Move slide ${i + 1} later`} className="rounded p-0.5 hover:text-ink disabled:opacity-30"><FaArrowDown className="-rotate-90" aria-hidden="true" /></button>
                </span>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <p className="mt-4 text-xs text-muted">
        The images are replaced by the PDF, and PDF carousels post to LinkedIn only. To post the images to Instagram or Facebook too, don&apos;t convert them: publish them as an image post instead.
      </p>
      {order.length > 20 && <div className="mt-3"><Notice>A carousel can have at most 20 images. Remove some first.</Notice></div>}
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}

      <div className="mt-6 flex flex-wrap justify-end gap-2.5">
        <button type="button" onClick={onClose} disabled={busy} className="btn">Cancel</button>
        <button type="button" onClick={create} disabled={busy || order.length < 2 || order.length > 20} className="btn btn-primary">
          {busy ? 'Building PDF…' : `Make ${order.length}-page carousel`}
        </button>
      </div>
    </Modal>
  )
}
