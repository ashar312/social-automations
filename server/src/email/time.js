'use strict';
// Time zone helpers (IANA names) without extra dependencies.
const dtfCache = new Map();
function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dtfCache.set(tz, f);
  }
  return f;
}

const validTimezone = (tz) => { try { dtf(tz); return typeof tz === 'string' && tz.length <= 64; } catch { return false; } };
const safeTz = (tz) => (validTimezone(tz) ? tz : 'UTC');

/** { y, m, d, h, mi, s } of `date` as seen in `tz`. */
function parts(date, tz) {
  const o = {};
  for (const p of dtf(safeTz(tz)).formatToParts(date)) o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second };
}
const pad = (n) => String(n).padStart(2, '0');
const ymd = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
const localDate = (date, tz) => ymd(parts(date, tz));
const localHour = (date, tz) => parts(date, tz).h;

/** UTC instant of local midnight at the start of day `y-m-d` in `tz`. */
function startOfLocalDay(y, m, d, tz) {
  const wall = Date.UTC(y, m - 1, d);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(guess), tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    const diff = shown - wall;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}
/** [start, end) UTC range of the local calendar day `offsetDays` days from now (-1 = yesterday). */
function localDayRange(now, tz, offsetDays = 0) {
  const p = parts(now, tz);
  const base = new Date(Date.UTC(p.y, p.m - 1, p.d + offsetDays));
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d + offsetDays + 1));
  return {
    start: startOfLocalDay(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), tz),
    end: startOfLocalDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz),
    date: `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`,
  };
}
const fmtTime = (date, tz) => new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz), hour: 'numeric', minute: '2-digit' }).format(date);
const fmtDateTime = (date, tz) => new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz), dateStyle: 'medium', timeStyle: 'short' }).format(date);
const fmtDate = (date, tz) => new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz), dateStyle: 'medium' }).format(date);

module.exports = { validTimezone, safeTz, parts, localDate, localHour, startOfLocalDay, localDayRange, fmtTime, fmtDateTime, fmtDate };
