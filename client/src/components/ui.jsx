import { useEffect, useRef } from 'react'
import {
  FaCheck, FaClock, FaFacebookF, FaForwardStep, FaGear, FaInstagram, FaLinkedinIn, FaTriangleExclamation,
  FaUpload, FaXmark, FaYoutube,
} from 'react-icons/fa6'
import { PLATFORM_LABEL } from '../api.js'

export const PLATFORM_META = {
  linkedin: { icon: FaLinkedinIn, color: '#0a66c2' },
  youtube: { icon: FaYoutube, color: '#e11d2e' },
  facebook: { icon: FaFacebookF, color: '#1877f2' },
  instagram: { icon: FaInstagram, color: '#d6286a' },
}

export function PlatformIcon({ platform, size = 'md' }) {
  const { icon: Icon, color } = PLATFORM_META[platform]
  return <span className={`platform-icon platform-icon-${size}`} style={{ '--pc': color }}><Icon aria-hidden="true" /></span>
}

const TARGET_STATUS = {
  published: { icon: FaCheck, tone: 'good', label: 'Published' },
  pending: { icon: FaClock, tone: 'info', label: 'Pending' },
  uploading: { icon: FaUpload, tone: 'live', label: 'Uploading' },
  processing: { icon: FaGear, tone: 'live', label: 'Processing' },
  failed: { icon: FaXmark, tone: 'bad', label: 'Failed' },
  skipped: { icon: FaForwardStep, tone: 'mute', label: 'Skipped' },
}

const POST_STATUS = {
  draft: { tone: 'mute', label: 'Draft' },
  queued: { tone: 'info', label: 'Queued' },
  publishing: { tone: 'live', label: 'Publishing' },
  completed: { tone: 'good', label: 'Completed' },
  partial: { tone: 'warn', label: 'Partial' },
  failed: { tone: 'bad', label: 'Failed' },
}

export const postTone = (status) => POST_STATUS[status]?.tone || 'mute'

export function PostStatus({ status }) {
  const s = POST_STATUS[status] || { tone: 'mute', label: status }
  return <span className={`pill pill-${s.tone}`}>{s.tone === 'live' && <span className="live-dot" />}{s.label}</span>
}

export function TargetStatus({ status }) {
  const s = TARGET_STATUS[status]
  const Icon = s.icon
  return <span className={`pill pill-${s.tone}`}><Icon className={status === 'processing' ? 'animate-spin' : ''} aria-hidden="true" />{s.label}</span>
}

export function TargetChip({ t }) {
  const s = TARGET_STATUS[t.status]
  const Icon = s.icon
  const active = ['uploading', 'processing'].includes(t.status)
  const body = (
    <>
      <PlatformIcon platform={t.platform} size="xs" />
      <span>{PLATFORM_LABEL[t.platform]}</span>
      <span className={`chip-state chip-state-${s.tone}`}>{active ? `${t.progress}%` : <Icon aria-label={s.label} />}</span>
    </>
  )
  return t.externalUrl
    ? <a href={t.externalUrl} target="_blank" rel="noreferrer" title={t.errorMessage || s.label} className="target-chip target-chip-link">{body}</a>
    : <span title={t.errorMessage || s.label} className="target-chip">{body}</span>
}

export function Bar({ pct, tone = 'brand', label, size = 'md' }) {
  const value = Math.max(0, Math.min(100, pct || 0))
  return (
    <div className={`bar bar-${size}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`bar-fill bar-${tone}`} style={{ width: `${value}%` }} />
    </div>
  )
}

/** Where a post came from: posts.created_via is null (app UI), "api" or "mcp:<AI app name>". */
export function ViaBadge({ via }) {
  if (!via) return null
  const mcp = via.startsWith('mcp:')
  const label = mcp ? `via MCP · ${via.slice(4) || 'AI app'}` : `via ${via.toUpperCase()}`
  return <span className="pill pill-info" title={mcp ? 'Created by an AI app through the MCP server' : 'Created through the external API'}>{label}</span>
}

export function Notice({ tone = 'bad', children }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      {tone === 'good' ? <FaCheck className="mt-0.5 shrink-0" aria-hidden="true" /> : <FaTriangleExclamation className="mt-0.5 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  )
}

export function PageTitle({ eyebrow, title, children }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">{title}</h1>
      </div>
      {children}
    </div>
  )
}

export function Modal({ label, onClose, children }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el.open) el.showModal()
    return () => { if (el.open) el.close() }
  }, [])
  return (
    <dialog
      ref={ref}
      aria-label={label}
      className="modal"
      onCancel={(e) => { e.preventDefault(); onClose() }}
      onClick={(e) => { if (e.target === ref.current) onClose() }}
    >
      <div className="modal-body">{children}</div>
    </dialog>
  )
}
