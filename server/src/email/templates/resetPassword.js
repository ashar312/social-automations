'use strict';
const { layout, p } = require('./layout');
const { AuthToken } = require('../../db/models');
const { sha256 } = require('../../services/auth');

/** Skip when the link was already used or has expired. */
async function check({ secret }) {
  if (!secret) return 'no token';
  const row = await AuthToken.findOne({ where: { token_hash: sha256(secret), purpose: 'reset_password' } });
  if (!row || row.used_at || row.expires_at.getTime() <= Date.now()) return 'reset token used or expired';
  return null;
}

function render({ user, secret, links }) {
  const url = `${links.app}/reset-password?token=${encodeURIComponent(secret)}`;
  return {
    subject: 'Reset your password',
    ...layout({ user, links }, {
      preheader: 'Choose a new password. The link works for 30 minutes.',
      heading: 'Reset your password',
      html: p('Use the button below to choose a new password. The link works for 30 minutes and only once.')
        + p('<span style="color:#667085">Didn&#39;t ask for this? Ignore this email, your password stays the same.</span>'),
      text: 'Use the link below to choose a new password. It works for 30 minutes and only once.\n\nDidn\'t ask for this? Ignore this email, your password stays the same.',
      button: { label: 'Reset password', url },
    }),
  };
}
const sample = () => ({ payload: {}, secret: 'sample-reset-token', data: null });
module.exports = { render, check, sample };
