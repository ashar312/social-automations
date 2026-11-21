'use strict';
// type (email_outbox.type) -> template module { render, sample, prepare?, check? }
module.exports = {
  welcome: require('./welcome'),
  social_connected: require('./socialConnected'),
  password_changed: require('./passwordChanged'),
  reset_password: require('./resetPassword'),
  daily_summary: require('./dailySummary'),
  first_post_nudge: require('./firstPostNudge'),
  feedback_request: require('./feedbackRequest'),
  inactive_nudge: require('./inactiveNudge'),
};
