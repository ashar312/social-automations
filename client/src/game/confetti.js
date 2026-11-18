const COLORS = ['#b6f427', '#ffc83d', '#3de0f5', '#ff7a8e', '#a58bff', '#ffffff']

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function burstConfetti({ count = 120, originY = 0.35 } = {}) {
  if (prefersReducedMotion()) return
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:90'
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  const bits = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2
    const speed = 4 + Math.random() * 11
    return {
      x: canvas.width / 2,
      y: canvas.height * originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 5,
      size: 5 + Math.random() * 7,
      spin: Math.random() * 6,
      turn: (Math.random() - 0.5) * 0.35,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }
  })

  const started = performance.now()
  const DURATION = 2200
  function frame(time) {
    const age = time - started
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.globalAlpha = Math.max(0, 1 - age / DURATION)
    for (const b of bits) {
      b.vy += 0.26
      b.vx *= 0.99
      b.x += b.vx
      b.y += b.vy
      b.spin += b.turn
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.rotate(b.spin)
      ctx.fillStyle = b.color
      ctx.fillRect(-b.size / 2, -b.size / 3, b.size, b.size * 0.66)
      ctx.restore()
    }
    if (age < DURATION) requestAnimationFrame(frame)
    else canvas.remove()
  }
  requestAnimationFrame(frame)
}
