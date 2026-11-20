import { useEffect, useRef, useState } from 'react'
import { FaChevronLeft, FaChevronRight, FaFilePdf } from 'react-icons/fa6'

// pdf.js is big: load it (and its worker) only when a PDF is actually on the page.
let pdfjsPromise = null
function loadPdfjs() {
  pdfjsPromise ||= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default
    return lib
  })
  return pdfjsPromise
}

/** Renders page `n` of `doc` into a canvas `width` CSS pixels wide. */
function PageCanvas({ doc, n, width, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    let task = null
    let gone = false
    doc.getPage(n).then((page) => {
      if (gone || !ref.current) return
      const base = page.getViewport({ scale: 1 })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: (width / base.width) * dpr })
      const canvas = ref.current
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      task = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport })
      task.promise.catch(() => { /* cancelled */ })
    }).catch(() => {})
    return () => { gone = true; task?.cancel() }
  }, [doc, n, width])
  return <canvas ref={ref} className={`block h-full w-full ${className}`} aria-hidden="true" />
}

/** Thumbnail that renders only once it scrolls into view. */
function Thumb({ doc, n, ratio, active, onClick }) {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } }, { rootMargin: '120px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={`Go to page ${n}`}
      aria-current={active ? 'true' : undefined}
      className={`relative w-14 flex-none overflow-hidden rounded-md border bg-white transition ${active ? 'border-brand ring-2 ring-brand/40' : 'border-line opacity-70 hover:opacity-100'}`}
      style={{ aspectRatio: ratio }}
    >
      {seen && <PageCanvas doc={doc} n={n} width={56} />}
      <span className="absolute bottom-0.5 right-1 text-[0.6rem] font-semibold text-muted">{n}</span>
    </button>
  )
}

const RATIOS = [[1, '1:1'], [4 / 5, '4:5'], [16 / 9, '16:9'], [1.91, '1.91:1'], [9 / 16, '9:16']]
const ratioLabel = (r) => (RATIOS.find(([x]) => Math.abs(r / x - 1) <= 0.03) || [0, r.toFixed(2)])[1]

/**
 * LinkedIn-style swipeable preview of a PDF carousel. Give it key={src} if src can change.
 * src = PDF URL; title = carousel header; size = bytes (optional); warnings = rule warnings to show inline.
 */
export default function CarouselPreview({ src, title, size, warnings = [], className = '' }) {
  const [doc, setDoc] = useState(null)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [info, setInfo] = useState(null) // { count, w, h }
  const [width, setWidth] = useState(360)
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const boxRef = useRef(null)
  const drag = useRef(null)
  const stripRef = useRef(null)

  useEffect(() => {
    let gone = false
    let loaded = null
    loadPdfjs()
      .then((lib) => lib.getDocument({ url: src, isEvalSupported: false }).promise)
      .then(async (d) => {
        loaded = d
        if (gone) { d.destroy(); return }
        const p1 = await d.getPage(1)
        const vp = p1.getViewport({ scale: 1 })
        setInfo({ count: d.numPages, w: Math.round(vp.width), h: Math.round(vp.height) })
        setDoc(d)
      })
      .catch((e) => { if (!gone) setError(/404|Missing/i.test(String(e?.message)) ? 'File removed' : 'Could not open this PDF') })
    return () => { gone = true; loaded?.destroy() }
  }, [src])

  // track the card width so pages render sharp at the size they're shown
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(120, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc])

  const count = info?.count || 0
  const go = (n) => setPage((cur) => Math.min(Math.max(1, typeof n === 'function' ? n(cur) : n), count || 1))

  // keep the active thumbnail in view
  useEffect(() => {
    const el = stripRef.current?.querySelector('[aria-current="true"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [page])

  if (error) {
    return (
      <div className={`flex items-center gap-3 rounded-xl border border-line bg-sunken p-4 text-sm text-muted ${className}`}>
        <FaFilePdf className="text-2xl text-bad" aria-hidden="true" />{error}
      </div>
    )
  }

  const ratio = info ? info.w / info.h : 4 / 5
  const onDown = (e) => { drag.current = { x: e.clientX }; setDragging(true); e.currentTarget.setPointerCapture(e.pointerId) }
  const onMove = (e) => { if (drag.current) setDx(e.clientX - drag.current.x) }
  const onUp = () => {
    if (!drag.current) return
    if (dx < -50) go((p) => p + 1)
    else if (dx > 50) go((p) => p - 1)
    drag.current = null
    setDragging(false)
    setDx(0)
  }

  return (
    <div className={`w-full max-w-md overflow-hidden rounded-xl border border-line bg-surface ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <span className="min-w-0 truncate text-sm font-semibold text-ink">{title?.trim() || <span className="font-normal italic text-muted">Untitled carousel</span>}</span>
        {count > 0 && <span className="flex-none text-xs font-medium text-muted">{count} pages</span>}
      </div>

      <div
        ref={boxRef}
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label={`PDF carousel, page ${page} of ${count || '…'}`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') { e.preventDefault(); go((p) => p + 1) }
          if (e.key === 'ArrowLeft') { e.preventDefault(); go((p) => p - 1) }
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="relative touch-pan-y select-none overflow-hidden bg-sunken outline-none focus-visible:ring-2 focus-visible:ring-brand"
        style={{ aspectRatio: ratio }}
      >
        {!doc && <div className="absolute inset-0 grid place-items-center text-sm text-muted">Loading PDF…</div>}
        {doc && (
          <div
            className="flex h-full"
            style={{ transform: `translateX(calc(${-(page - 1) * 100}% + ${dx}px))`, transition: dragging ? 'none' : 'transform 250ms ease' }}
          >
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="h-full w-full flex-none bg-white">
                {/* only the current page and its neighbours are rendered, so big PDFs stay fast */}
                {Math.abs(i + 1 - page) <= 1 && <PageCanvas doc={doc} n={i + 1} width={width} />}
              </div>
            ))}
          </div>
        )}
        {doc && page > 1 && (
          <button type="button" onClick={() => go((p) => p - 1)} onPointerDown={(e) => e.stopPropagation()} aria-label="Previous page"
            className="absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white hover:bg-black/75">
            <FaChevronLeft aria-hidden="true" />
          </button>
        )}
        {doc && page < count && (
          <button type="button" onClick={() => go((p) => p + 1)} onPointerDown={(e) => e.stopPropagation()} aria-label="Next page"
            className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white hover:bg-black/75">
            <FaChevronRight aria-hidden="true" />
          </button>
        )}
        {count > 0 && (
          <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">{page} / {count}</span>
        )}
      </div>

      {doc && count > 1 && (
        <div ref={stripRef} className="flex gap-1.5 overflow-x-auto border-t border-line p-2">
          {Array.from({ length: count }, (_, i) => (
            <Thumb key={i} doc={doc} n={i + 1} ratio={ratio} active={page === i + 1} onClick={() => go(i + 1)} />
          ))}
        </div>
      )}

      {info && (
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          {info.count} page{info.count === 1 ? '' : 's'} · {info.w}×{info.h} pt ({ratioLabel(ratio)}){size != null ? ` · ${(size / 1048576).toFixed(1)} MB` : ''}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-0.5 border-t border-line px-3 py-2">
          {warnings.map((w) => <li key={w} className="text-xs font-medium text-warn">{w}</li>)}
        </ul>
      )}
    </div>
  )
}
