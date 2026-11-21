'use strict';
// Queries the templates and jobs share. Everything is scoped to one user through projects.user_id.
const { Op } = require('sequelize');
const { Post, PostTarget, PlatformAccount, Project } = require('../db/models');
const { startOfLocalDay } = require('./time');

const projectIds = async (userId) => (await Project.findAll({ where: { user_id: userId }, attributes: ['id'] })).map((p) => p.id);

async function postCount(userId) {
  const ids = await projectIds(userId);
  return ids.length ? Post.count({ where: { project_id: { [Op.in]: ids } } }) : 0;
}

/** Connected platforms with their projects: [{ platform, project, name }] */
async function connections(userId) {
  return PlatformAccount.findAll({
    include: [{ model: Project, as: 'project', required: true, where: { user_id: userId, archived_at: null }, attributes: ['id', 'name'] }],
    order: [['platform', 'ASC']],
  });
}

/** UTC [start, end) of the local calendar day `dateStr` (YYYY-MM-DD) in `tz`. */
function rangeForDate(dateStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return { start: startOfLocalDay(y, m, d, tz), end: startOfLocalDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz) };
}

/**
 * Scheduled posts of the user whose targets finished (published or failed) inside [start, end).
 * Returns [{ post, project, targets: [PostTarget] }] ordered by scheduled time.
 */
async function finishedScheduled(userId, start, end) {
  const targets = await PostTarget.findAll({
    where: { status: { [Op.in]: ['published', 'failed'] }, finished_at: { [Op.gte]: start, [Op.lt]: end } },
    include: [
      { model: Post, as: 'post', required: true, where: { scheduled_at: { [Op.ne]: null } },
        include: [{ model: Project, as: 'project', required: true, where: { user_id: userId }, attributes: ['id', 'name', 'color'] }] },
      { model: PlatformAccount, as: 'account', required: false, attributes: ['display_name'] },
    ],
    order: [['finished_at', 'ASC'], ['id', 'ASC']],
  });
  const byPost = new Map();
  for (const t of targets) {
    if (!byPost.has(t.post_id)) byPost.set(t.post_id, { post: t.post, project: t.post.project, targets: [] });
    byPost.get(t.post_id).targets.push(t);
  }
  return [...byPost.values()].sort((a, b) => new Date(a.post.scheduled_at) - new Date(b.post.scheduled_at));
}

/** Posts scheduled to go out in [from, to), soonest first. */
async function upcoming(userId, from, to, limit = 50) {
  const ids = await projectIds(userId);
  if (!ids.length) return [];
  return Post.findAll({
    where: { project_id: { [Op.in]: ids }, status: 'queued', scheduled_at: { [Op.gte]: from, [Op.lt]: to } },
    order: [['scheduled_at', 'ASC']], limit,
  });
}

async function lastPublishedAt(userId) {
  const t = await PostTarget.findOne({
    where: { status: 'published' },
    include: [{ model: Post, as: 'post', required: true, attributes: [], include: [{ model: Project, as: 'project', required: true, attributes: [], where: { user_id: userId } }] }],
    order: [['finished_at', 'DESC']],
  });
  return t ? t.finished_at : null;
}

module.exports = { projectIds, postCount, connections, rangeForDate, finishedScheduled, upcoming, lastPublishedAt };
