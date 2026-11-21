import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaFacebook, FaInstagram, FaLinkedin } from 'react-icons/fa6'
import { api } from '../../api.js'

export function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2.5" aria-label="Social Automations home">
          <img src="/logo.svg" alt="" className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight text-ink">Social Automations</span>
        </Link>
        <div className="card p-6">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mb-5 mt-1 text-sm text-muted">{subtitle}</p>}
          {children}
        </div>
        {footer && <p className="mt-4 text-center text-sm text-muted">{footer}</p>}
      </div>
    </div>
  )
}

const ITEMS = [['linkedin', 'LinkedIn', FaLinkedin], ['facebook', 'Facebook', FaFacebook], ['instagram', 'Instagram', FaInstagram]]

/** Continue-with buttons. LinkedIn is live; Facebook and Instagram show "coming soon" until their flag is on. */
export function SocialButtons({ next }) {
  const [p, setP] = useState(null)
  useEffect(() => { api.get('/api/auth/providers').then(setP).catch(() => setP({})) }, [])
  const q = next ? `&next=${encodeURIComponent(next)}` : ''
  return (
    <div className="space-y-2">
      {ITEMS.map(([key, label, Icon]) => (p?.[key]
        ? <a key={key} href={`/api/auth/${key}/start?mode=login${q}`} className="btn btn-ghost w-full justify-center"><Icon aria-hidden="true" />Continue with {label}</a>
        : <button key={key} type="button" disabled className="btn btn-ghost w-full justify-center opacity-60"><Icon aria-hidden="true" />{label} <span className="text-xs">(coming soon)</span></button>))}
    </div>
  )
}

export const Divider = () => (
  <div className="my-4 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
)
