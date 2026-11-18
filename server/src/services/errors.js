'use strict';
class PublishError extends Error {
  constructor(message, { retryable = false, raw = null, reconnect = false } = {}) {
    super(message);
    this.retryable = retryable;
    this.raw = raw;
    this.reconnect = reconnect;
  }
}

/** Turn an axios/googleapis error into a PublishError. */
function fromHttp(err, prefix = '') {
  if (err instanceof PublishError) return err;
  const res = err.response;
  const status = res && res.status;
  const data = res && res.data;
  let msg = (data && (data.error?.message || data.error_description || data.message || (typeof data.error === 'string' && data.error))) || err.message;
  if (typeof msg !== 'string') msg = JSON.stringify(msg);
  const code = data && data.error && data.error.code;
  const reconnect = status === 401 || code === 190;
  const retryable = !status || status >= 500 || status === 429 || ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(err.code);
  return new PublishError(`${prefix}${msg}${status ? ` (HTTP ${status})` : ''}`, { retryable: retryable && !reconnect, raw: data || { message: err.message }, reconnect });
}
module.exports = { PublishError, fromHttp };
