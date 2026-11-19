'use strict';
const { Project } = require('../db/models');
const { hash, fromRequest } = require('../services/apiKeys');

const fail = (res, status, code, error) => res.status(status).json({ ok: false, code, error });

/**
 * External API auth. The API key identifies exactly one project; when the URL also names a project
 * (/projects/:projectId), it must be that same project. Sets req.project.
 */
async function apiAuth(req, res, next) {
  try {
    const key = fromRequest(req);
    if (!key) return fail(res, 401, 'missing_api_key', 'Send the project API key as "Authorization: Bearer <key>"');
    const project = await Project.findOne({ where: { api_key_hash: hash(key) } });
    if (!project) return fail(res, 401, 'invalid_api_key', 'Unknown or revoked API key');
    const wanted = req.params.projectId;
    if (wanted && wanted !== project.public_id) {
      return fail(res, 403, 'project_mismatch', `This API key belongs to project ${project.public_id}, not ${wanted}`);
    }
    if (project.archived_at) return fail(res, 403, 'project_archived', 'This project is archived. Restore it in the app first.');
    // last-used stamp, at most once a minute per project
    const last = project.api_key_last_used_at;
    if (!last || Date.now() - new Date(last).getTime() > 60_000) {
      await Project.update({ api_key_last_used_at: new Date() }, { where: { id: project.id }, silent: true });
    }
    req.project = project;
    next();
  } catch (e) { next(e); }
}
module.exports = apiAuth;
