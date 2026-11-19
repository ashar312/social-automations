'use strict';
function notFound(req, res) {
  res.status(404).json({ ok: false, error: 'Not found' });
}
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  const body = { ok: false, error: status >= 500 ? 'Internal server error' : err.message };
  if (status < 500 && err.results) body.results = err.results; // per-platform validation details
  res.status(status).json(body);
}
module.exports = { notFound, errorHandler };
