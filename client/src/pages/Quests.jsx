import { Link } from 'react-router-dom'
import { FaBolt, FaCheck, FaFire, FaLock, FaPaperPlane, FaRocket, FaStar } from 'react-icons/fa6'
import { PLATFORMS, PLATFORM_LABEL } from '../api.js'
import { Bar, CountUp, PageTitle, PlatformIcon, PLATFORM_META } from '../components/ui.jsx'
import { dayKey, masteryFor, XP_RULES } from '../game/engine.js'
import { useGame } from '../game/useGame.js'

const WEEKS = 14

function Heatmap({ byDay }) {
  const today = new Date()
  const start = new Date(today)
  start.setDate(today.getDate() - today.getDay() - (WEEKS - 1) * 7)
  const cells = Array.from({ length: WEEKS * 7 }, (_, i) => {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    const key = dayKey(date)
    return { key, date, count: byDay[key]?.published || 0, future: date > today, today: key === dayKey(today) }
  })
  return (
    <div className="grid grid-flow-col grid-rows-7 gap-1" role="img" aria-label={`Publishing activity for the last ${WEEKS} weeks`}>
      {cells.map((c) => (
        <div
          key={c.key}
          title={c.future ? undefined : `${c.date.toLocaleDateString()}: ${c.count} published`}
          className={`heat ${c.future ? 'heat-future' : c.count ? `heat-${Math.min(c.count, 4)}` : ''} ${c.today ? 'heat-today' : ''}`}
        />
      ))}
    </div>
  )
}

function Stat({ icon: Icon, label, value, color, index }) {
  return (
    <div style={{ '--i': index }} className="rounded-2xl bg-ink-950/70 p-3">
      <Icon className={`mb-1 ${color}`} aria-hidden="true" />
      <p className="font-display text-3xl leading-none tabular-nums"><CountUp value={value} /></p>
      <p className="mt-1 text-xs font-bold text-ink-300">{label}</p>
    </div>
  )
}

function XpRule({ label, xp }) {
  return <li className="flex items-center justify-between gap-3"><span>{label}</span><span className="xp-tag">+{xp}</span></li>
}

export default function Quests() {
  const { stats } = useGame()
  if (!stats) return <div className="space-y-4" aria-label="Loading"><div className="skeleton h-56" /><div className="skeleton h-72" /></div>

  const unlocked = stats.achievements.filter((a) => a.unlocked).length
  const questsDone = stats.quests.filter((q) => q.done).length
  const achievements = [...stats.achievements].sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || b.pct - a.pct)

  return (
    <div>
      <PageTitle eyebrow="Your progress" title="Quests" />

      <section className="panel mb-6 overflow-hidden p-5 sm:p-6">
        <div className="grid items-center gap-6 lg:grid-cols-[1.15fr_1fr]">
          <div className="flex items-center gap-5">
            <div className="levelup-badge float-slow !h-24 !w-24 shrink-0 !text-5xl"><span>{stats.level}</span></div>
            <div className="min-w-0 flex-1">
              <p className="eyebrow">Level {stats.level}</p>
              <h2 className="font-display text-3xl leading-tight sm:text-4xl">{stats.title}</h2>
              <div className="mt-3"><Bar pct={stats.pct} size="lg" label="Progress to next level" /></div>
              <p className="mt-1.5 text-sm font-bold text-ink-200"><span className="tabular-nums text-xp">{(stats.needed - stats.into).toLocaleString()} XP</span> to level {stats.level + 1}</p>
            </div>
          </div>
          <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            <Stat index={0} icon={FaBolt} label="Total XP" value={stats.xp} color="text-xp" />
            <Stat index={1} icon={FaFire} label="Day streak" value={stats.streak} color="text-flame" />
            <Stat index={2} icon={FaStar} label="Best streak" value={stats.bestStreak} color="text-gold" />
            <Stat index={3} icon={FaPaperPlane} label="Publishes" value={stats.published} color="text-aqua" />
          </div>
        </div>
      </section>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <section className="panel p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="panel-title">Daily quests</h2>
            <span className={`pill ${questsDone === stats.quests.length ? 'pill-good' : 'pill-info'}`}>{questsDone}/{stats.quests.length} done</span>
          </div>
          <ul className="stagger space-y-2.5">
            {stats.quests.map((q, i) => {
              const Icon = q.icon
              return (
                <li key={q.id} style={{ '--i': i }} className={`flex items-center gap-3 rounded-2xl bg-ink-950/70 p-2.5 ${q.done ? 'quest-done' : ''}`}>
                  <span className="quest-check">{q.done ? <FaCheck aria-label="Done" /> : <Icon aria-hidden="true" />}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold">{q.name}</p>
                    <p className="text-xs text-ink-300">{q.desc}</p>
                  </div>
                  <span className="xp-tag">+{q.xp}</span>
                </li>
              )
            })}
          </ul>
          {questsDone < stats.quests.length
            ? <Link to="/compose" className="btn btn-xp mt-4 w-full"><FaRocket aria-hidden="true" />Start a post</Link>
            : <p className="mt-4 text-center text-sm font-extrabold text-xp">All clear today. New quests arrive at midnight.</p>}
        </section>

        <section className="panel p-5">
          <h2 className="panel-title mb-4">Platform mastery</h2>
          <ul className="stagger space-y-4">
            {PLATFORMS.map((p, i) => {
              const count = stats.perPlatform[p]
              const m = masteryFor(count)
              return (
                <li key={p} style={{ '--i': i, '--pc': PLATFORM_META[p].color }} className="flex items-center gap-3">
                  <PlatformIcon platform={p} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-extrabold">{PLATFORM_LABEL[p]} <span className="text-xs font-bold text-ink-300">Tier {m.tier}</span></span>
                      <span className="text-xs font-bold tabular-nums text-ink-300">{m.maxed ? `${count} · Max tier` : `${count}/${m.goal}`}</span>
                    </div>
                    <Bar pct={m.pct} tone="platform" label={`${PLATFORM_LABEL[p]} mastery`} />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      <section className="panel mb-6 p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="panel-title">Trophy case</h2>
          <span className="pill pill-warn">{unlocked}/{stats.achievements.length} unlocked</span>
        </div>
        <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {achievements.map((a, i) => {
            const Icon = a.icon
            return (
              <li key={a.id} style={{ '--i': i }}>
                <div className={`trophy ${a.unlocked ? `trophy-on trophy-${a.tier}` : ''}`}>
                  <span className="trophy-gem">{a.unlocked ? <Icon aria-hidden="true" /> : <FaLock aria-hidden="true" />}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold leading-tight">{a.name}</p>
                    <p className="mb-1.5 text-xs text-ink-300">{a.desc}</p>
                    {a.unlocked
                      ? <span className="pill pill-good"><FaCheck aria-hidden="true" />Unlocked</span>
                      : (
                        <div className="flex items-center gap-2">
                          <div className="flex-1"><Bar pct={a.pct} tone="gold" size="sm" label={`${a.name} progress`} /></div>
                          <span className="text-[0.7rem] font-extrabold tabular-nums text-ink-300">{a.current}/{a.goal}</span>
                        </div>
                      )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section className="panel p-5">
          <h2 className="panel-title mb-4">Activity</h2>
          <Heatmap byDay={stats.byDay} />
        </section>
        <section className="panel p-5">
          <h2 className="panel-title mb-3">How to earn XP</h2>
          <ul className="space-y-2 text-sm text-ink-200">
            <XpRule label="Each platform published" xp={XP_RULES.perPlatform} />
            <XpRule label="Combo, each extra platform" xp={XP_RULES.comboPerExtra} />
            <XpRule label="Image post" xp={XP_RULES.media.image} />
            <XpRule label="Video post" xp={XP_RULES.media.video} />
            <XpRule label="Reel or Short" xp={XP_RULES.media.reel} />
          </ul>
        </section>
      </div>
    </div>
  )
}
