'use strict';
const { Project } = require('../db/models');

/** router.param('projectId', loadProject): 404s on unknown ids, sets req.project. */
async function loadProject(req, res, next, id) {
  try {
    const p = /^\d+$/.test(id) ? await Project.findByPk(Number(id)) : null;
    if (!p || !req.user || p.user_id !== req.user.id) return res.status(404).json({ ok: false, error: 'Project not found' });
    req.project = p;
    next();
  } catch (e) { next(e); }
}
module.exports = loadProject;
