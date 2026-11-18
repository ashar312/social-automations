// Pure game rules. Everything is derived from real post history, so scores can always be recomputed.
import {
  FaBolt, FaBullseye, FaCalendarCheck, FaCamera, FaClapperboard, FaCrown, FaFire, FaGem,
  FaHeartPulse, FaLink, FaMedal, FaRocket, FaShieldHalved, FaStar, FaTrophy,
} from 'react-icons/fa6'

export const XP_RULES = {
  perPlatform: 50,
  comboPerExtra: 25,
  media: { text: 0, image: 10, video: 20, reel: 30 },
}

export const LEVEL_TITLES = [
  'Rookie Poster', 'Caption Cadet', 'Feed Runner', 'Hashtag Hero', 'Reel Ranger',
  'Trend Tamer', 'Viral Vanguard', 'Algorithm Ace', 'Content Champion', 'Social Legend',
]

export const levelTitle = (level) => LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length) - 1]

// Total XP needed to reach a level: each level costs 50 XP more than the one before.
export const xpForLevel = (level) => 100 * (level - 1) + 25 * (level - 1) * (level - 2)

export function levelFromXp(xp) {
  let level = 1
  while (xp >= xpForLevel(level + 1)) level += 1
  const floor = xpForLevel(level)
  const ceiling = xpForLevel(level + 1)
  return { level, title: levelTitle(level), into: xp - floor, needed: ceiling - floor, pct: ((xp - floor) / (ceiling - floor)) * 100 }
}

export function previewXp(contentType, platformCount) {
  if (!platformCount) return 0
  return platformCount * XP_RULES.perPlatform + (platformCount - 1) * XP_RULES.comboPerExtra + (XP_RULES.media[contentType] || 0)
}

export const postXp = (post) => previewXp(post.contentType, post.targets.filter((t) => t.status === 'published').length)

export function dayKey(value) {
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d }

const DAILY_QUESTS = [
  { id: 'launch', name: 'Daily launch', desc: 'Publish one post today', xp: 20, icon: FaRocket, test: (d) => d.launches >= 1 },
  { id: 'combo', name: 'Combo move', desc: 'Land one post on 2+ platforms', xp: 30, icon: FaBolt, test: (d) => d.maxCombo >= 2 },
  { id: 'media', name: 'Show, don’t tell', desc: 'Publish an image or video', xp: 30, icon: FaCamera, test: (d) => d.media >= 1 },
]

function streaks(days, now) {
  let best = 0
  let run = 0
  let prev = null
  for (const key of [...days].sort()) {
    const [y, m, d] = key.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    run = prev && dayKey(addDays(prev, 1)) === key ? run + 1 : 1
    best = Math.max(best, run)
    prev = date
  }
  // A streak stays alive until a full day is missed, so today can still extend it.
  let current = 0
  let cursor = days.has(dayKey(now)) ? now : addDays(now, -1)
  while (days.has(dayKey(cursor))) { current += 1; cursor = addDays(cursor, -1) }
  return { current, best }
}

const ACHIEVEMENTS = [
  { id: 'first', name: 'Liftoff', desc: 'Publish your first post', icon: FaRocket, tier: 'bronze', goal: 1, value: (s) => s.launches },
  { id: 'hat-trick', name: 'Hat Trick', desc: 'Land one post on 3 platforms', icon: FaBullseye, tier: 'silver', goal: 3, value: (s) => s.maxCombo },
  { id: 'grand-slam', name: 'Grand Slam', desc: 'Land one post on all 4 platforms', icon: FaCrown, tier: 'gold', goal: 4, value: (s) => s.maxCombo },
  { id: 'director', name: 'Director’s Cut', desc: 'Publish 5 videos or reels', icon: FaClapperboard, tier: 'silver', goal: 5, value: (s) => s.videos },
  { id: 'shutterbug', name: 'Shutterbug', desc: 'Publish 10 image posts', icon: FaCamera, tier: 'silver', goal: 10, value: (s) => s.images },
  { id: 'warm', name: 'Warming Up', desc: 'Reach a 3-day streak', icon: FaFire, tier: 'bronze', goal: 3, value: (s) => s.bestStreak },
  { id: 'blaze', name: 'Unstoppable', desc: 'Reach a 7-day streak', icon: FaFire, tier: 'gold', goal: 7, value: (s) => s.bestStreak },
  { id: 'planner', name: 'Time Lord', desc: 'Publish 3 scheduled posts', icon: FaCalendarCheck, tier: 'bronze', goal: 3, value: (s) => s.scheduled },
  { id: 'survivor', name: 'Comeback Kid', desc: 'Publish after an automatic retry', icon: FaHeartPulse, tier: 'bronze', goal: 1, value: (s) => s.survivors },
  { id: 'linked', name: 'Full Party', desc: 'Connect all 4 platforms', icon: FaLink, tier: 'silver', goal: 4, value: (s) => s.connected },
  { id: 'all-rounder', name: 'All-Rounder', desc: 'Publish on every platform', icon: FaShieldHalved, tier: 'silver', goal: 4, value: (s) => s.platformsUsed },
  { id: 'fifty', name: 'Half Century', desc: 'Reach 50 platform publishes', icon: FaMedal, tier: 'silver', goal: 50, value: (s) => s.published },
  { id: 'century', name: 'Centurion', desc: 'Reach 100 platform publishes', icon: FaTrophy, tier: 'gold', goal: 100, value: (s) => s.published },
  { id: 'level-5', name: 'Rising Star', desc: 'Reach level 5', icon: FaStar, tier: 'silver', goal: 5, value: (s) => s.level },
  { id: 'level-10', name: 'Social Legend', desc: 'Reach level 10', icon: FaGem, tier: 'gold', goal: 10, value: (s) => s.level },
]

export const MASTERY_TIERS = [5, 15, 30, 60, 100]

export function masteryFor(count) {
  const tier = MASTERY_TIERS.filter((goal) => count >= goal).length
  const maxed = tier === MASTERY_TIERS.length
  const goal = maxed ? MASTERY_TIERS.at(-1) : MASTERY_TIERS[tier]
  const floor = tier ? MASTERY_TIERS[tier - 1] : 0
  return { tier, goal, pct: maxed ? 100 : ((count - floor) / (goal - floor)) * 100, maxed }
}

export function buildStats(posts, connections, now = new Date()) {
  const byDay = {}
  const perPlatform = { linkedin: 0, youtube: 0, facebook: 0, instagram: 0 }
  const totals = { published: 0, launches: 0, maxCombo: 0, videos: 0, images: 0, scheduled: 0, survivors: 0 }
  let xp = 0

  for (const post of posts) {
    const live = post.targets.filter((t) => t.status === 'published')
    if (!live.length) continue
    xp += postXp(post)
    totals.published += live.length
    totals.launches += 1
    totals.maxCombo = Math.max(totals.maxCombo, live.length)
    if (['video', 'reel'].includes(post.contentType)) totals.videos += 1
    if (post.contentType === 'image') totals.images += 1
    if (post.scheduledAt) totals.scheduled += 1
    if (live.some((t) => t.attempts >= 1)) totals.survivors += 1
    for (const t of live) perPlatform[t.platform] += 1

    const finished = live.map((t) => t.finishedAt).filter(Boolean).sort()[0] || post.createdAt
    const key = dayKey(finished)
    const day = (byDay[key] ||= { launches: 0, published: 0, maxCombo: 0, media: 0 })
    day.launches += 1
    day.published += live.length
    day.maxCombo = Math.max(day.maxCombo, live.length)
    if (post.contentType !== 'text') day.media += 1
  }

  for (const day of Object.values(byDay)) {
    for (const quest of DAILY_QUESTS) if (quest.test(day)) xp += quest.xp
  }

  const streak = streaks(new Set(Object.keys(byDay)), now)
  const today = byDay[dayKey(now)] || { launches: 0, published: 0, maxCombo: 0, media: 0 }
  const stats = {
    ...totals,
    ...levelFromXp(xp),
    xp,
    byDay,
    perPlatform,
    streak: streak.current,
    bestStreak: streak.best,
    postedToday: today.launches > 0,
    platformsUsed: Object.values(perPlatform).filter(Boolean).length,
    connected: connections.filter((c) => ['connected', 'error'].includes(c.status)).length,
  }
  stats.quests = DAILY_QUESTS.map(({ test, ...quest }) => ({ ...quest, done: test(today) }))
  stats.achievements = ACHIEVEMENTS.map(({ value, ...achievement }) => {
    const progress = Math.min(value(stats), achievement.goal)
    return { ...achievement, current: progress, unlocked: progress >= achievement.goal, pct: (progress / achievement.goal) * 100 }
  })
  return stats
}
