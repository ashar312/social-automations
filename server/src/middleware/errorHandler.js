'use strict';
function notFound(req, res) {
  res.status(404).json({ ok: false, error: 'Not found' });
}
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ ok: false, error: status >= 500 ? 'Internal server error' : err.message });
}
module.exports = { notFound, errorHandler };
